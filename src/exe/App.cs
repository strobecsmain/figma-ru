// The window.
//
// Compiled as a WinExe, so nothing flashes a console. WPF ships with Windows, so
// the whole program is one self-contained file the user downloads and runs.
//
// The UI never touches Figma's files on the UI thread: the work runs on a
// background thread and reports back through the dispatcher, so a slow disk
// cannot freeze the window mid-install.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;
using System.Windows.Input;
using System.Windows.Markup;
using System.Windows.Media;
using System.Xml;

namespace FigmaRu
{
    public static class Program
    {
        [STAThread]
        public static int Main(string[] args)
        {
            // Unattended mode, for scripted rollouts and for testing the engine
            // without a window. Double-clicking passes no arguments and always
            // gets the UI.
            bool install = Array.IndexOf(args, "--install") >= 0;
            bool uninstall = Array.IndexOf(args, "--uninstall") >= 0;
            if (install || uninstall) return RunSilent(args, install);

            Application app = new Application();
            try
            {
                MainWindow window = new MainWindow();
                app.Run(window.Window);
            }
            catch (Exception e)
            {
                MessageBox.Show(
                    "Не удалось открыть окно установщика.\n\n" + e.Message,
                    "Figma на русском", MessageBoxButton.OK, MessageBoxImage.Error);
                return 1;
            }
            return 0;
        }

        private static int RunSilent(string[] args, bool installing)
        {
            List<string> lines = new List<string>();
            Action<string> log = delegate(string line) { lines.Add(line); };

            int failed = 0;
            int done = 0;
            try
            {
                InstallOptions options = new InstallOptions();
                options.ShellOnly = Array.IndexOf(args, "--shell-only") >= 0;
                options.AllBuilds = Array.IndexOf(args, "--all") >= 0;

                List<FigmaInstall> installs = Patcher.Discover();
                if (installs.Count == 0)
                {
                    log("Figma не найдена.");
                    failed = 1;
                }

                List<string> running = Patcher.RunningApps(installs);
                if (running.Count > 0)
                {
                    log("Figma запущена (" + string.Join(", ", running.ToArray()) + ") — закройте её.");
                    failed = 1;
                }

                if (failed == 0)
                {
                    foreach (FigmaInstall target in installs)
                    {
                        if (installing && !options.AllBuilds && !target.IsCurrent) continue;
                        if (!installing && !target.IsPatched) continue;

                        log(target.Product + " " + target.Version);
                        try
                        {
                            if (installing) Patcher.Install(target, options, log);
                            else Patcher.Uninstall(target, log);
                            done++;
                        }
                        catch (Exception e)
                        {
                            log("  НЕ УДАЛОСЬ: " + e.Message);
                            failed++;
                        }
                    }
                    log(string.Format("Готово: {0}, с ошибкой: {1}", done, failed));
                }
            }
            catch (Exception e)
            {
                log("Ошибка: " + e.Message);
                failed++;
            }

            int logIndex = Array.IndexOf(args, "--log");
            if (logIndex >= 0 && logIndex + 1 < args.Length)
            {
                try { File.WriteAllLines(args[logIndex + 1], lines.ToArray(), Encoding.UTF8); }
                catch { }
            }
            return failed == 0 ? 0 : 1;
        }
    }

    public sealed class MainWindow
    {
        public readonly Window Window;

        private readonly StackPanel _buildList;
        private readonly Border _noticeBox;
        private readonly TextBlock _noticeText;
        private readonly Button _install;
        private readonly Button _uninstall;
        private readonly Button _refresh;
        private readonly CheckBox _shellOnly;
        private readonly CheckBox _allBuilds;
        private readonly TextBlock _status;
        private readonly TextBlock _log;
        private readonly ScrollViewer _logScroll;

        private List<FigmaInstall> _installs = new List<FigmaInstall>();
        private bool _busy;

        public MainWindow()
        {
            using (XmlReader reader = XmlReader.Create(new StringReader(Xaml.Window)))
            {
                Window = (Window)XamlReader.Load(reader);
            }

            _buildList = (StackPanel)Window.FindName("BuildList");
            _noticeBox = (Border)Window.FindName("NoticeBox");
            _noticeText = (TextBlock)Window.FindName("NoticeText");
            _install = (Button)Window.FindName("BtnInstall");
            _uninstall = (Button)Window.FindName("BtnUninstall");
            _refresh = (Button)Window.FindName("BtnRefresh");
            _shellOnly = (CheckBox)Window.FindName("ChkShellOnly");
            _allBuilds = (CheckBox)Window.FindName("ChkAll");
            _status = (TextBlock)Window.FindName("StatusText");
            _log = (TextBlock)Window.FindName("LogText");
            _logScroll = (ScrollViewer)Window.FindName("LogScroll");

            ((Grid)Window.FindName("TitleBar")).MouseLeftButtonDown += delegate { Window.DragMove(); };
            ((Button)Window.FindName("BtnClose")).Click += delegate { Window.Close(); };
            ((Button)Window.FindName("BtnMin")).Click += delegate { Window.WindowState = WindowState.Minimized; };

            _install.Click += delegate { Run(true); };
            _uninstall.Click += delegate { Run(false); };
            _refresh.Click += delegate { if (!_busy) Refresh(); };

            Refresh();
        }

        // ------------------------------------------------------------------
        // Rendering
        // ------------------------------------------------------------------

        private static Brush Brush(string hex)
        {
            return (Brush)new BrushConverter().ConvertFrom(hex);
        }

        private void Notice(string text, string kind)
        {
            if (string.IsNullOrEmpty(text))
            {
                _noticeBox.Visibility = Visibility.Collapsed;
                return;
            }
            string background = "#28FFCD29", foreground = "#FFFFD966";
            if (kind == "error") { background = "#24F24822"; foreground = "#FFFF9F8C"; }
            else if (kind == "ok") { background = "#2214AE5C"; foreground = "#FF6FD39B"; }

            _noticeBox.Background = Brush(background);
            _noticeText.Foreground = Brush(foreground);
            _noticeText.Text = text;
            _noticeBox.Visibility = Visibility.Visible;
        }

        private void Status(string text, string kind)
        {
            string color = "#FFB3B3B3";
            if (kind == "ok") color = "#FF6FD39B";
            else if (kind == "bad") color = "#FFFF9F8C";
            else if (kind == "warn") color = "#FFFFD966";
            _status.Text = text;
            _status.Foreground = Brush(color);
        }

        private void Log(string line)
        {
            _log.Text += line + Environment.NewLine;
            _logScroll.ScrollToEnd();
        }

        private void AddBuildRow(FigmaInstall install)
        {
            Grid row = new Grid { Margin = new Thickness(0, 0, 0, 8) };
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            StackPanel text = new StackPanel();
            text.Children.Add(new TextBlock
            {
                Text = install.Product + " " + install.Version,
                FontWeight = FontWeights.Medium,
                Foreground = Brush("#FFFFFFFF"),
            });
            text.Children.Add(new TextBlock
            {
                Text = install.IsCurrent ? "текущая версия" : "старая сборка",
                FontSize = 11,
                Foreground = Brush("#FF8C8C8C"),
            });
            Grid.SetColumn(text, 0);
            row.Children.Add(text);

            Border badge = new Border
            {
                CornerRadius = new CornerRadius(4),
                Padding = new Thickness(7, 3, 7, 3),
                VerticalAlignment = VerticalAlignment.Center,
                Background = Brush(install.IsPatched ? "#2E14AE5C" : "#FF383838"),
            };
            badge.Child = new TextBlock
            {
                Text = install.IsPatched ? "на русском" : "на английском",
                FontSize = 10,
                Foreground = Brush(install.IsPatched ? "#FF6FD39B" : "#FF8C8C8C"),
            };
            Grid.SetColumn(badge, 2);
            row.Children.Add(badge);

            _buildList.Children.Add(row);
        }

        private void Refresh()
        {
            _buildList.Children.Clear();
            try
            {
                _installs = Patcher.Discover();
            }
            catch (Exception e)
            {
                Notice("Не удалось проверить, что установлено: " + e.Message, "error");
                return;
            }

            if (_installs.Count == 0)
            {
                _buildList.Children.Add(new TextBlock
                {
                    Text = "Ничего не найдено.",
                    Foreground = Brush("#FF8C8C8C"),
                });
                Notice("Figma не найдена на этом компьютере. Если она установлена, но программа её не видит — " +
                       "не запускайте эту программу от имени администратора: Figma ставится в профиль " +
                       "пользователя, и из-под администратора её не видно.", "error");
                _install.IsEnabled = false;
                _uninstall.IsEnabled = false;
                return;
            }

            int patched = 0;
            foreach (FigmaInstall install in _installs)
            {
                AddBuildRow(install);
                if (install.IsPatched) patched++;
            }

            List<string> running = Patcher.RunningApps(_installs);
            if (running.Count > 0)
            {
                Notice("Figma сейчас запущена (" + string.Join(", ", running.ToArray()) + "). " +
                       "Закройте окно Figma и нажмите «Обновить». Если окна не видно: " +
                       "Ctrl+Shift+Esc → Figma → «Снять задачу». Значок Figma Agent в трее закрывать не нужно.",
                       "warn");
                _install.IsEnabled = false;
                _uninstall.IsEnabled = false;
            }
            else if (patched > 0)
            {
                Notice("Перевод установлен. Сборок на русском: " + patched + ".", "ok");
                _install.IsEnabled = true;
                _uninstall.IsEnabled = true;
            }
            else
            {
                Notice(null, null);
                _install.IsEnabled = true;
                _uninstall.IsEnabled = false;
            }
        }

        // ------------------------------------------------------------------
        // Work
        // ------------------------------------------------------------------

        private void Run(bool installing)
        {
            if (_busy) return;
            _busy = true;
            _install.IsEnabled = false;
            _uninstall.IsEnabled = false;
            _refresh.IsEnabled = false;
            _log.Text = "";
            Status(installing ? "Устанавливаю перевод…" : "Возвращаю английский…", "dim");

            InstallOptions options = new InstallOptions
            {
                ShellOnly = _shellOnly.IsChecked == true,
                AllBuilds = _allBuilds.IsChecked == true,
            };

            List<FigmaInstall> targets = new List<FigmaInstall>();
            foreach (FigmaInstall install in _installs)
            {
                if (installing && !options.AllBuilds && !install.IsCurrent) continue;
                if (!installing && !install.IsPatched) continue;
                targets.Add(install);
            }

            Action<string> log = delegate(string line)
            {
                Window.Dispatcher.Invoke(new Action(delegate { Log(line); }));
            };

            Thread worker = new Thread(delegate()
            {
                int done = 0;
                List<string> failed = new List<string>();

                foreach (FigmaInstall install in targets)
                {
                    log("");
                    log(install.Product + " " + install.Version);
                    try
                    {
                        if (installing) Patcher.Install(install, options, log);
                        else Patcher.Uninstall(install, log);
                        done++;
                    }
                    catch (Exception e)
                    {
                        log("  НЕ УДАЛОСЬ: " + e.Message);
                        log("  файлы Figma остались без изменений");
                        failed.Add(install.Product + " " + install.Version);
                    }
                }

                int total = targets.Count;
                Window.Dispatcher.Invoke(new Action(delegate
                {
                    if (total == 0)
                    {
                        Status("Нечего делать.", "warn");
                    }
                    else if (failed.Count == 0)
                    {
                        Status(installing
                            ? "Готово. Запустите Figma."
                            : "Готово. Figma снова на английском.", "ok");
                    }
                    else
                    {
                        Status("Не удалось: " + string.Join(", ", failed.ToArray()) +
                               ". Файлы Figma остались без изменений.", "bad");
                    }
                    _busy = false;
                    _refresh.IsEnabled = true;
                    Refresh();
                }));
            });

            worker.IsBackground = true;
            worker.Start();
        }
    }
}
