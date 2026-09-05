// Files baked into the executable at build time.
//
// The point of shipping a single .exe is that there is nothing to unpack and
// nothing to install alongside it, so the Russian dictionary and the editor
// translation layer travel inside the binary and are read straight into memory.
using System;
using System.IO;
using System.Reflection;

namespace FigmaRu
{
    public static class Resources
    {
        public static byte[] Read(string name)
        {
            Assembly assembly = Assembly.GetExecutingAssembly();
            using (Stream stream = assembly.GetManifestResourceStream(name))
            {
                if (stream == null)
                    throw new Exception("В программе нет встроенного файла «" + name + "» — сборка неполная.");

                using (MemoryStream memory = new MemoryStream())
                {
                    stream.CopyTo(memory);
                    return memory.ToArray();
                }
            }
        }
    }
}
