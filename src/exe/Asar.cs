// Read and rebuild Figma's app.asar.
//
// Three constraints, all found the hard way, all with the same symptom — Figma
// runs main.js, logs one line and exits, with no error anywhere:
//
//   * The ".codesign" entry has size -1000. Stock asar tooling rejects the
//     archive outright because of it, which is why this is hand-written.
//   * Eight bytes sit after the last file and belong to no entry. Rebuild
//     without them and the app will not start.
//   * The archive's total length is checked. An otherwise perfect rebuild that
//     is 64 bytes longer does not boot, so the packer has to land on an exact
//     size (see FitToExactSize).
using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Text;

namespace FigmaRu
{
    public sealed class AsarEntry
    {
        public string Path;
        public JsonObject Node;

        /// <summary>True for directories.</summary>
        public bool IsDirectory { get { return Node.Has("files"); } }

        /// <summary>
        /// True when the bytes live outside the archive: entries flagged
        /// "unpacked" (they sit in app.asar.unpacked) and the ".codesign"
        /// placeholder, whose size is negative.
        /// </summary>
        public bool IsExternal
        {
            get
            {
                if (Node.Get("unpacked") is JsonLiteral && Node.Get("unpacked").ToJson() == "true") return true;
                JsonNumber size = Node.Get("size") as JsonNumber;
                return size == null || size.Value < 0;
            }
        }

        public long Size { get { return ((JsonNumber)Node.Get("size")).AsLong(); } }

        public long Offset
        {
            get
            {
                JsonValue value = Node.Get("offset");
                JsonString text = value as JsonString;
                if (text != null) return long.Parse(text.Value);
                return ((JsonNumber)value).AsLong();
            }
        }
    }

    public sealed class AsarArchive
    {
        private const int BlockSize = 4 * 1024 * 1024;

        public byte[] Buffer;
        public JsonObject Header;
        public int DataOffset;
        public byte[] Trailer;

        public static AsarArchive Read(string path)
        {
            return Read(File.ReadAllBytes(path));
        }

        /// <summary>
        /// Parse from bytes already in memory. The size-fitting loop repacks the
        /// same source several times and packing rewrites the header, so each
        /// attempt starts from a freshly parsed copy rather than re-reading disk.
        /// </summary>
        public static AsarArchive Read(byte[] buffer)
        {
            if (buffer.Length < 16) throw new InvalidDataException("Файл слишком мал для архива Figma");

            int headerPickleSize = BitConverter.ToInt32(buffer, 4);
            int headerStringSize = BitConverter.ToInt32(buffer, 12);
            if (headerStringSize <= 0 || 16 + headerStringSize > buffer.Length)
                throw new InvalidDataException("Заголовок архива повреждён");

            string json = Encoding.UTF8.GetString(buffer, 16, headerStringSize);
            AsarArchive archive = new AsarArchive();
            archive.Buffer = buffer;
            archive.Header = (JsonObject)JsonParser.Parse(json);
            archive.DataOffset = 8 + headerPickleSize;

            long end = 0;
            foreach (AsarEntry entry in archive.Files())
            {
                if (entry.IsExternal) continue;
                end = Math.Max(end, entry.Offset + entry.Size);
            }
            int trailerStart = archive.DataOffset + (int)end;
            archive.Trailer = new byte[buffer.Length - trailerStart];
            Array.Copy(buffer, trailerStart, archive.Trailer, 0, archive.Trailer.Length);

            return archive;
        }

        /// <summary>Every file entry, in header order, with "/"-joined paths.</summary>
        public IEnumerable<AsarEntry> Files()
        {
            return Walk(Header, "");
        }

        private static IEnumerable<AsarEntry> Walk(JsonObject node, string prefix)
        {
            JsonObject files = node.GetObject("files");
            if (files == null) yield break;

            foreach (string name in new List<string>(files.Keys))
            {
                JsonObject child = files.GetObject(name);
                if (child == null) continue;
                string path = prefix.Length == 0 ? name : prefix + "/" + name;

                if (child.Has("files"))
                {
                    foreach (AsarEntry nested in Walk(child, path)) yield return nested;
                }
                else
                {
                    AsarEntry entry = new AsarEntry();
                    entry.Path = path;
                    entry.Node = child;
                    yield return entry;
                }
            }
        }

        public AsarEntry Find(string path)
        {
            foreach (AsarEntry entry in Files())
            {
                if (string.Equals(entry.Path, path, StringComparison.Ordinal)) return entry;
            }
            return null;
        }

        public byte[] ReadFile(string path)
        {
            AsarEntry entry = Find(path);
            if (entry == null || entry.IsExternal) return null;
            byte[] bytes = new byte[entry.Size];
            Array.Copy(Buffer, DataOffset + entry.Offset, bytes, 0, bytes.Length);
            return bytes;
        }

        /// <summary>Locate the directory node that holds the archive's locale files.</summary>
        public JsonObject LocaleFolder()
        {
            JsonObject files = Header.GetObject("files");
            if (files == null) return null;
            JsonObject i18n = files.GetObject("i18n");
            return i18n == null ? null : i18n.GetObject("files");
        }

        private static JsonObject Integrity(byte[] bytes)
        {
            JsonObject integrity = new JsonObject();
            integrity.Set("algorithm", new JsonString("SHA256"));

            using (SHA256 sha = SHA256.Create())
            {
                integrity.Set("hash", new JsonString(Hex(sha.ComputeHash(bytes))));

                JsonArray blocks = new JsonArray();
                if (bytes.Length == 0)
                {
                    blocks.Items.Add(new JsonString(Hex(sha.ComputeHash(new byte[0]))));
                }
                else
                {
                    for (int offset = 0; offset < bytes.Length; offset += BlockSize)
                    {
                        int length = Math.Min(BlockSize, bytes.Length - offset);
                        blocks.Items.Add(new JsonString(Hex(sha.ComputeHash(bytes, offset, length))));
                    }
                }
                integrity.Set("blockSize", new JsonNumber(BlockSize));
                integrity.Set("blocks", blocks);
            }
            return integrity;
        }

        private static string Hex(byte[] bytes)
        {
            StringBuilder sb = new StringBuilder(bytes.Length * 2);
            foreach (byte b in bytes) sb.Append(b.ToString("x2"));
            return sb.ToString();
        }

        /// <summary>
        /// Rebuild the archive from `contents` (path -> bytes). Entries missing
        /// from the map keep their current bytes; entries whose path maps to null
        /// are dropped. The header is mutated, so callers pass a fresh copy when
        /// they intend to retry.
        /// </summary>
        public byte[] Pack(Dictionary<string, byte[]> contents)
        {
            List<byte[]> chunks = new List<byte[]>();
            long offset = 0;

            foreach (AsarEntry entry in Files())
            {
                if (entry.IsExternal) continue;

                byte[] bytes;
                if (!contents.TryGetValue(entry.Path, out bytes)) bytes = ReadFile(entry.Path);
                if (bytes == null) continue;

                chunks.Add(bytes);
                entry.Node.Set("offset", new JsonString(offset.ToString()));
                entry.Node.Set("size", new JsonNumber(bytes.Length));
                if (entry.Node.Has("integrity")) entry.Node.Set("integrity", Integrity(bytes));
                offset += bytes.Length;
            }

            byte[] headerBytes = Encoding.UTF8.GetBytes(Header.ToJson());
            int padding = (4 - (headerBytes.Length % 4)) % 4;

            using (MemoryStream stream = new MemoryStream())
            {
                stream.Write(BitConverter.GetBytes(4), 0, 4);
                stream.Write(BitConverter.GetBytes(8 + headerBytes.Length + padding), 0, 4);
                stream.Write(BitConverter.GetBytes(4 + headerBytes.Length + padding), 0, 4);
                stream.Write(BitConverter.GetBytes(headerBytes.Length), 0, 4);
                stream.Write(headerBytes, 0, headerBytes.Length);
                stream.Write(new byte[padding], 0, padding);
                foreach (byte[] chunk in chunks) stream.Write(chunk, 0, chunk.Length);
                stream.Write(Trailer, 0, Trailer.Length);
                return stream.ToArray();
            }
        }
    }
}
