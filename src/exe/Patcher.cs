// Finding Figma, and applying or removing the translation.
//
// This is a port of the Node implementation the patch was developed with; the
// reasoning behind each step lives in README.md. Nothing here is specific to a
// release channel: stable and beta differ only by folder and executable name.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;

namespace FigmaRu
{
    public sealed class FigmaInstall
    {
        public string Product;
        public string Channel;
        public string Version;
        public string BuildDir;
        public string AsarPath;
        public string BackupPath;
        public string ExePath;
        public bool IsCurrent;

        public bool IsPatched { get { return File.Exists(BackupPath); } }
    }

    public sealed class InstallOptions
    {
        public bool ShellOnly;
        public bool AllBuilds;
    }

    public static class Patcher
    {
        public const string Locale = "ru";
        public const string LayerMarker = "figma-ru:editor-layer";

        // The shell funnels every locale decision — the OS locale, the value
        // restored from settings.json, and the "setLocales" message the web app
        // sends once it knows the account language — through this one helper.
        // Identifiers are minified and change with every Figma build, so it is
        // matched by shape.
        private static readonly Regex LocaleFunnel = new Regex(
            @"function\s+([A-Za-z_$][\w$]*)\s*\(\s*([A-Za-z_$][\w$]*)\s*\)\s*\{" +
            @"var\s+([A-Za-z_$][\w$]*);" +
            @"return\s*\(\s*\3\s*=\s*\2\.filter\(\s*([A-Za-z_$][\w$]*)\s*=>\s*" +
            @"([A-Za-z_$][\w$]*)\.includes\(\s*\4\s*\)\s*\)\[0\]\s*\)\s*!=\s*null\s*\?" +
            @"\s*\3\s*:\s*([A-Za-z_$][\w$]*)\.DEFAULT\s*\}",
            RegexOptions.Compiled);

        // Sacrificed in this order when the archive will not otherwise fit.
        private static readonly string[] SacrificeOrder =
            { "ja", "ko-kr", "pt-br", "es-la", "es-es", "fr", "de" };

        private static readonly Dictionary<string, string[]> KnownProducts =
            new Dictionary<string, string[]>(StringComparer.OrdinalIgnoreCase)
            {
                { "Figma", new[] { "Figma", "stable" } },
                { "FigmaBeta", new[] { "Figma Beta", "beta" } },
                { "FigmaGov", new[] { "Figma Gov", "gov" } },
                { "FigmaSycamore", new[] { "Figma Sycamore", "sycamore" } },
                { "FigmaDev", new[] { "Figma Dev", "dev" } },
            };

        // ------------------------------------------------------------------
        // Discovery
        // ------------------------------------------------------------------

        public static List<FigmaInstall> Discover()
        {
            List<FigmaInstall> found = new List<FigmaInstall>();

            string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            if (!string.IsNullOrEmpty(local)) ScanSquirrel(local, found);

            foreach (Environment.SpecialFolder folder in new[]
                     { Environment.SpecialFolder.ProgramFiles, Environment.SpecialFolder.ProgramFilesX86 })
            {
                string dir = Environment.GetFolderPath(folder);
                if (!string.IsNullOrEmpty(dir)) ScanFlat(dir, found);
            }
            return found;
        }

        private static string[] Describe(string folderName)
        {
            string[] known;
            if (KnownProducts.TryGetValue(folderName, out known)) return known;
            if (!folderName.StartsWith("Figma", StringComparison.OrdinalIgnoreCase)) return null;
            // The font helper installs beside the app under the same prefix.
            if (folderName.Equals("FigmaAgent", StringComparison.OrdinalIgnoreCase)) return null;
            string channel = folderName.Substring("Figma".Length).ToLowerInvariant();
            return new[] { folderName, channel.Length == 0 ? "stable" : channel };
        }

        private static void ScanSquirrel(string root, List<FigmaInstall> found)
        {
            foreach (string productDir in SafeDirectories(root))
            {
                string[] product = Describe(Path.GetFileName(productDir));
                if (product == null) continue;

                List<FigmaInstall> builds = new List<FigmaInstall>();
                foreach (string buildDir in SafeDirectories(productDir))
                {
                    string name = Path.GetFileName(buildDir);
                    if (!name.StartsWith("app-", StringComparison.OrdinalIgnoreCase)) continue;
                    // Squirrel leaves a ".dead" marker in folders it could not clean up.
                    if (File.Exists(Path.Combine(buildDir, ".dead"))) continue;

                    string asar = Path.Combine(buildDir, "resources", "app.asar");
                    if (!File.Exists(asar)) continue;

                    builds.Add(Make(product, name.Substring(4), buildDir, asar));
                }

                builds.Sort((a, b) => CompareVersions(b.Version, a.Version));
                for (int i = 0; i < builds.Count; i++) builds[i].IsCurrent = i == 0;
                found.AddRange(builds);
            }
        }

        private static void ScanFlat(string root, List<FigmaInstall> found)
        {
            foreach (string dir in SafeDirectories(root))
            {
                string[] product = Describe(Path.GetFileName(dir));
                if (product == null) continue;
                string asar = Path.Combine(dir, "resources", "app.asar");
                if (!File.Exists(asar)) continue;
                FigmaInstall install = Make(product, "установленная", dir, asar);
                install.IsCurrent = true;
                found.Add(install);
            }
        }

        private static FigmaInstall Make(string[] product, string version, string buildDir, string asar)
        {
            FigmaInstall install = new FigmaInstall();
            install.Product = product[0];
            install.Channel = product[1];
            install.Version = version;
            install.BuildDir = buildDir;
            install.AsarPath = asar;
            install.BackupPath = asar + ".figma-ru-orig";
            install.ExePath = FindExecutable(buildDir, product[0]);
            return install;
        }

        private static IEnumerable<string> SafeDirectories(string path)
        {
            try { return Directory.GetDirectories(path); }
            catch { return new string[0]; }
        }

        /// <summary>
        /// The build's own binary. Squirrel's stub sits beside it, so those names
        /// are excluded rather than assuming the file matches the product name.
        /// </summary>
        private static string FindExecutable(string buildDir, string label)
        {
            string[] candidates;
            try { candidates = Directory.GetFiles(buildDir, "*.exe"); }
            catch { return null; }

            List<string> usable = candidates
                .Where(p => !Regex.IsMatch(Path.GetFileName(p), @"^(squirrel|update)\.exe$", RegexOptions.IgnoreCase))
                .ToList();

            string exact = usable.FirstOrDefault(
                p => string.Equals(Path.GetFileName(p), label + ".exe", StringComparison.OrdinalIgnoreCase));
            if (exact != null) return exact;

            // Otherwise the largest .exe: the app binary dwarfs any helper stub.
            string best = null;
            long bestSize = -1;
            foreach (string p in usable)
            {
                try
                {
                    long size = new FileInfo(p).Length;
                    if (size > bestSize) { bestSize = size; best = p; }
                }
                catch { }
            }
            return best;
        }

        private static int CompareVersions(string a, string b)
        {
            string[] pa = a.Split('.'), pb = b.Split('.');
            for (int i = 0; i < Math.Max(pa.Length, pb.Length); i++)
            {
                int na = 0, nb = 0;
                if (i < pa.Length) int.TryParse(pa[i], out na);
                if (i < pb.Length) int.TryParse(pb[i], out nb);
                if (na != nb) return na.CompareTo(nb);
            }
            return 0;
        }

        /// <summary>
        /// Figma processes currently running. Deliberately narrow: figma_agent.exe
        /// is a separate font helper that owns the tray icon, keeps running while
        /// the app is closed, and does not hold app.asar open.
        /// </summary>
        public static List<string> RunningApps(IEnumerable<FigmaInstall> installs)
        {
            HashSet<string> wanted = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (FigmaInstall install in installs)
            {
                if (install.ExePath != null) wanted.Add(Path.GetFileNameWithoutExtension(install.ExePath));
            }
            if (wanted.Count == 0) { wanted.Add("Figma"); wanted.Add("Figma Beta"); }

            List<string> running = new List<string>();
            foreach (Process process in Process.GetProcesses())
            {
                try
                {
                    if (wanted.Contains(process.ProcessName) && !running.Contains(process.ProcessName))
                        running.Add(process.ProcessName);
                }
                catch { }
                finally { process.Dispose(); }
            }
            return running;
        }

        // ------------------------------------------------------------------
        // Is this archive Figma's own, untouched file?
        // ------------------------------------------------------------------

        /// <summary>
        /// Reasons to believe this archive is NOT Figma's own untouched file.
        ///
        /// Deliberately keyed on traces this patch leaves behind, never on
        /// whether the locale funnel still matches. Those are not the same
        /// question: a Figma build whose minified code is shaped differently is
        /// pristine but unrecognised, and rejecting it here would abort the whole
        /// install — including the editor layer, which does not depend on that
        /// code at all — and tell the user to reinstall Figma, which would
        /// reproduce the very same shape.
        /// </summary>
        public static List<string> WhyNotStock(string archivePath)
        {
            List<string> reasons = new List<string>();
            AsarArchive archive;
            try { archive = AsarArchive.Read(archivePath); }
            catch (Exception e) { reasons.Add("архив не читается (" + e.Message + ")"); return reasons; }

            if (archive.Find("i18n/" + Locale + ".json") != null)
                reasons.Add("в нём уже есть словарь " + Locale);

            byte[] preload = archive.ReadFile("web_app_binding_renderer.js");
            if (preload != null && Encoding.UTF8.GetString(preload).Contains(LayerMarker))
                reasons.Add("в нём уже есть слой перевода редактора");

            byte[] main = archive.ReadFile("main.js");
            if (main == null) reasons.Add("в нём нет main.js");
            else if (Regex.IsMatch(Encoding.UTF8.GetString(main),
                     @"function\s+[A-Za-z_$][\w$]*\s*\(\s*[A-Za-z_$][\w$]*\s*\)\s*\{\s*return\s*""" + Locale + @"""\s*\}"))
                reasons.Add("язык в нём уже закреплён этим патчем");

            return reasons;
        }

        // ------------------------------------------------------------------
        // Install
        // ------------------------------------------------------------------

        public static void Install(FigmaInstall install, InstallOptions options, Action<string> log)
        {
            // Always rebuild from the pristine archive, so re-running is safe.
            string source;
            if (File.Exists(install.BackupPath))
            {
                List<string> bad = WhyNotStock(install.BackupPath);
                if (bad.Count > 0)
                {
                    throw new Exception(
                        "сохранённая копия оригинала повреждена (" + string.Join("; ", bad.ToArray()) +
                        "). Переустановите Figma, иначе вернуть английскую версию будет нечем");
                }
                source = install.BackupPath;
                log("  собираю заново из сохранённой копии оригинала");
            }
            else
            {
                List<string> bad = WhyNotStock(install.AsarPath);
                if (bad.Count > 0)
                {
                    throw new Exception(
                        "этот файл Figma уже изменён (" + string.Join("; ", bad.ToArray()) +
                        "), а копии оригинала рядом нет. Переустановите Figma и попробуйте снова");
                }
                File.Copy(install.AsarPath, install.BackupPath, false);
                source = install.BackupPath;
                log("  оригинал сохранён рядом с приложением");
            }

            byte[] sourceBytes = File.ReadAllBytes(source);
            long target = sourceBytes.Length;

            byte[] dictionary = Resources.Read("ru.json");
            byte[] layer = options.ShellOnly ? null : Resources.Read("editor-layer.js");

            // Work out the edits once; the packing loop then only varies padding
            // and, if it has to, which dictionaries were dropped.
            AsarArchive probe = AsarArchive.Read(source);

            byte[] mainBytes = probe.ReadFile("main.js");
            if (mainBytes == null) throw new Exception("в архиве нет main.js — это не похоже на сборку Figma");

            string mainText = Encoding.UTF8.GetString(mainBytes);
            Match funnel = LocaleFunnel.Match(mainText);
            bool shellPatched = funnel.Success;
            byte[] patchedMain = null;
            if (shellPatched)
            {
                string replacement = "function " + funnel.Groups[1].Value + "(" +
                                     funnel.Groups[2].Value + "){return\"" + Locale + "\"}";
                patchedMain = Encoding.UTF8.GetBytes(mainText.Substring(0, funnel.Index) + replacement +
                                                     mainText.Substring(funnel.Index + funnel.Length));
                log("  язык оболочки закреплён за русским");
            }
            else
            {
                log("  ! меню и диалоги останутся английскими: в этой версии Figma код выглядит иначе");
            }

            byte[] patchedPreload = null;
            if (layer != null)
            {
                byte[] preload = probe.ReadFile("web_app_binding_renderer.js");
                if (preload == null)
                {
                    log("  ! не найден preload веб-вида — интерфейс редактора не будет переведён");
                }
                else
                {
                    using (MemoryStream stream = new MemoryStream())
                    {
                        stream.Write(preload, 0, preload.Length);
                        byte[] newline = Encoding.UTF8.GetBytes("\n");
                        stream.Write(newline, 0, newline.Length);
                        stream.Write(layer, 0, layer.Length);
                        stream.Write(newline, 0, newline.Length);
                        patchedPreload = stream.ToArray();
                    }
                    log("  слой перевода редактора подготовлен");
                }
            }

            if (!shellPatched && patchedPreload == null)
                throw new Exception("не удалось применить ни одну часть перевода");

            // Freeing space: minifying the dictionaries Figma ships pretty-printed
            // costs nothing — every language keeps working.
            List<string> shipped = new List<string>();
            JsonObject locales = probe.LocaleFolder();
            if (locales != null)
            {
                foreach (string name in locales.Keys)
                {
                    if (name.EndsWith(".json", StringComparison.OrdinalIgnoreCase))
                        shipped.Add(name.Substring(0, name.Length - 5));
                }
            }

            Dictionary<string, byte[]> edits = new Dictionary<string, byte[]>(StringComparer.Ordinal);
            if (shellPatched) edits["main.js"] = patchedMain;
            if (patchedPreload != null) edits["web_app_binding_renderer.js"] = patchedPreload;

            long reclaimed = 0;
            foreach (string name in shipped)
            {
                if (name == Locale) continue;
                byte[] original = probe.ReadFile("i18n/" + name + ".json");
                if (original == null) continue;
                byte[] minified = Encoding.UTF8.GetBytes(JsonParser.Minify(Encoding.UTF8.GetString(original)));
                if (minified.Length < original.Length)
                {
                    edits["i18n/" + name + ".json"] = minified;
                    reclaimed += original.Length - minified.Length;
                }
            }
            log(string.Format("  освобождено {0} Б сжатием словарей", reclaimed));

            log("  собираю архив, это занимает несколько секунд…");

            byte[] result = FitToExactSize(sourceBytes, edits, dictionary, target, shipped, log);

            // Nothing is replaced until the rebuilt archive proves sound: a bad
            // one fails exactly like every other failure here — Figma just exits.
            Verify(result, target, probe.Trailer.Length, shellPatched, patchedPreload != null);
            log("  проверка собранного архива пройдена");

            // Staged beside the target so the final step is a same-volume rename:
            // app.asar is either replaced completely or not at all.
            string staging = install.AsarPath + ".figma-ru-new";
            File.WriteAllBytes(staging, result);
            if (File.Exists(install.AsarPath)) File.Delete(install.AsarPath);
            File.Move(staging, install.AsarPath);
            log("  готово");
        }

        /// <summary>
        /// Pack repeatedly until the archive is exactly `target` bytes: pad the
        /// Russian dictionary with trailing spaces to make up a shortfall, and if
        /// even a full minify pass leaves it too big, give up one shipped language
        /// at a time.
        /// </summary>
        private static byte[] FitToExactSize(byte[] sourceBytes, Dictionary<string, byte[]> baseEdits,
            byte[] dictionary, long target, List<string> shipped, Action<string> log)
        {
            List<string> dropped = new List<string>();
            int padding = 0;

            for (int attempt = 0; attempt < 40; attempt++)
            {
                // A fresh header every attempt: packing rewrites offsets into it.
                AsarArchive archive = AsarArchive.Read(sourceBytes);

                Dictionary<string, byte[]> edits = new Dictionary<string, byte[]>(baseEdits, StringComparer.Ordinal);

                JsonObject locales = archive.LocaleFolder();
                if (locales == null) throw new Exception("в архиве нет папки словарей i18n");

                foreach (string victim in dropped) locales.Remove(victim + ".json");

                byte[] padded = new byte[dictionary.Length + padding];
                Array.Copy(dictionary, padded, dictionary.Length);
                for (int i = dictionary.Length; i < padded.Length; i++) padded[i] = (byte)' ';

                string dictName = Locale + ".json";
                if (!locales.Has(dictName))
                {
                    JsonObject entry = new JsonObject();
                    entry.Set("size", new JsonNumber(0));
                    entry.Set("offset", new JsonString("0"));
                    entry.Set("integrity", new JsonObject());
                    locales.Set(dictName, entry);
                }
                edits["i18n/" + dictName] = padded;

                byte[] packed = archive.Pack(edits);

                if (packed.LongLength == target) return packed;

                if (packed.LongLength < target)
                {
                    padding += (int)(target - packed.LongLength);
                    continue;
                }

                long excess = packed.LongLength - target;
                if (padding > 0)
                {
                    padding = (int)Math.Max(0, padding - excess);
                    continue;
                }

                string next = NextSacrifice(shipped, dropped);
                if (next == null)
                    throw new Exception("не хватает места в архиве, и жертвовать больше нечем");
                dropped.Add(next);
                log(string.Format("  не хватает {0} Б: удаляю словарь «{1}»", excess, next));
                log("  ! в меню Figma перестанет работать язык: " + next);
            }
            throw new Exception("не удалось подогнать размер архива");
        }

        private static string NextSacrifice(List<string> shipped, List<string> dropped)
        {
            foreach (string candidate in SacrificeOrder)
            {
                if (shipped.Contains(candidate) && !dropped.Contains(candidate)) return candidate;
            }
            foreach (string candidate in shipped)
            {
                if (candidate != Locale && !dropped.Contains(candidate)) return candidate;
            }
            return null;
        }

        private static void Verify(byte[] packed, long expectedSize, int expectedTrailer,
            bool shellPatched, bool hasLayer)
        {
            if (packed.LongLength != expectedSize)
                throw new Exception("размер собранного архива не совпал — Figma отказалась бы запускаться");

            AsarArchive archive = AsarArchive.Read(packed);

            if (archive.Trailer.Length != expectedTrailer)
                throw new Exception("потерян хвост архива — Figma не запустилась бы");

            foreach (AsarEntry entry in archive.Files())
            {
                if (entry.IsExternal) continue;
                long start = archive.DataOffset + entry.Offset;
                if (start < archive.DataOffset || start + entry.Size > packed.LongLength)
                    throw new Exception("запись " + entry.Path + " выходит за границы архива");
            }

            byte[] dict = archive.ReadFile("i18n/" + Locale + ".json");
            if (dict == null) throw new Exception("в собранном архиве нет русского словаря");
            JsonObject parsed = JsonParser.Parse(Encoding.UTF8.GetString(dict)) as JsonObject;
            if (parsed == null || parsed.Count == 0) throw new Exception("русский словарь не читается");

            if (shellPatched)
            {
                byte[] main = archive.ReadFile("main.js");
                string text = main == null ? "" : Encoding.UTF8.GetString(main);
                if (!Regex.IsMatch(text, @"function\s+[A-Za-z_$][\w$]*\s*\(\s*[A-Za-z_$][\w$]*\s*\)\s*\{\s*return\s*""" + Locale + @"""\s*\}"))
                    throw new Exception("патч языка не попал в собранный архив");
            }

            if (hasLayer)
            {
                byte[] preload = archive.ReadFile("web_app_binding_renderer.js");
                if (preload == null || !Encoding.UTF8.GetString(preload).Contains(LayerMarker))
                    throw new Exception("слой перевода редактора не попал в собранный архив");
            }
        }

        // ------------------------------------------------------------------
        // Uninstall
        // ------------------------------------------------------------------

        public static void Uninstall(FigmaInstall install, Action<string> log)
        {
            if (!File.Exists(install.BackupPath))
            {
                log("  копии оригинала нет — пропускаю");
                return;
            }

            List<string> bad = WhyNotStock(install.BackupPath);
            if (bad.Count > 0)
            {
                throw new Exception(
                    "сохранённая копия не похожа на оригинал (" + string.Join("; ", bad.ToArray()) +
                    ") — не трогаю. Верните английскую версию, переустановив Figma");
            }

            string staging = install.AsarPath + ".figma-ru-restore";
            File.Copy(install.BackupPath, staging, true);
            if (File.Exists(install.AsarPath)) File.Delete(install.AsarPath);
            File.Move(staging, install.AsarPath);
            File.Delete(install.BackupPath);
            log("  восстановлено");
        }
    }
}
