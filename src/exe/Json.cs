// Minimal JSON reader/writer for the asar header.
//
// Written by hand rather than using a framework serialiser for two reasons:
// the header's key order must survive a round trip (it is rewritten in place,
// entry by entry), and the output must be compact in the same way Node's
// JSON.stringify is compact, since the archive's total size is fixed and every
// byte of the header counts against it.
//
// Numbers keep their original text so an untouched entry serialises back
// byte-for-byte; only values this patch actually changes are re-rendered.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace FigmaRu
{
    public abstract class JsonValue
    {
        public abstract void Write(StringBuilder sb);

        public string ToJson()
        {
            StringBuilder sb = new StringBuilder();
            Write(sb);
            return sb.ToString();
        }
    }

    public sealed class JsonObject : JsonValue
    {
        private readonly List<string> _order = new List<string>();
        private readonly Dictionary<string, JsonValue> _map = new Dictionary<string, JsonValue>(StringComparer.Ordinal);

        public IEnumerable<string> Keys { get { return _order; } }
        public int Count { get { return _order.Count; } }

        public bool Has(string key) { return _map.ContainsKey(key); }

        public JsonValue Get(string key)
        {
            JsonValue value;
            return _map.TryGetValue(key, out value) ? value : null;
        }

        public JsonObject GetObject(string key) { return Get(key) as JsonObject; }

        public void Set(string key, JsonValue value)
        {
            if (!_map.ContainsKey(key)) _order.Add(key);
            _map[key] = value;
        }

        public void Remove(string key)
        {
            if (_map.Remove(key)) _order.Remove(key);
        }

        public override void Write(StringBuilder sb)
        {
            sb.Append('{');
            for (int i = 0; i < _order.Count; i++)
            {
                if (i > 0) sb.Append(',');
                JsonWriter.WriteString(sb, _order[i]);
                sb.Append(':');
                _map[_order[i]].Write(sb);
            }
            sb.Append('}');
        }
    }

    public sealed class JsonArray : JsonValue
    {
        public readonly List<JsonValue> Items = new List<JsonValue>();

        public override void Write(StringBuilder sb)
        {
            sb.Append('[');
            for (int i = 0; i < Items.Count; i++)
            {
                if (i > 0) sb.Append(',');
                Items[i].Write(sb);
            }
            sb.Append(']');
        }
    }

    public sealed class JsonString : JsonValue
    {
        public readonly string Value;
        public JsonString(string value) { Value = value; }
        public override void Write(StringBuilder sb) { JsonWriter.WriteString(sb, Value); }
    }

    public sealed class JsonNumber : JsonValue
    {
        private readonly string _raw;
        public readonly double Value;

        public JsonNumber(double value)
        {
            Value = value;
            _raw = value == Math.Floor(value) && !double.IsInfinity(value)
                ? ((long)value).ToString(CultureInfo.InvariantCulture)
                : value.ToString("R", CultureInfo.InvariantCulture);
        }

        public JsonNumber(string raw, double value) { _raw = raw; Value = value; }

        public long AsLong() { return (long)Value; }

        public override void Write(StringBuilder sb) { sb.Append(_raw); }
    }

    public sealed class JsonLiteral : JsonValue
    {
        private readonly string _text;
        public JsonLiteral(string text) { _text = text; }
        public bool IsNull { get { return _text == "null"; } }
        public override void Write(StringBuilder sb) { sb.Append(_text); }
    }

    public static class JsonWriter
    {
        /// <summary>Escapes exactly what JSON.stringify escapes; non-ASCII stays literal.</summary>
        public static void WriteString(StringBuilder sb, string value)
        {
            sb.Append('"');
            for (int i = 0; i < value.Length; i++)
            {
                char c = value[i];
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\b': sb.Append("\\b"); break;
                    case '\f': sb.Append("\\f"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < ' ') sb.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                        else sb.Append(c);
                        break;
                }
            }
            sb.Append('"');
        }
    }

    public static class JsonParser
    {
        public static JsonValue Parse(string text)
        {
            int i = 0;
            JsonValue value = ParseValue(text, ref i);
            SkipWhitespace(text, ref i);
            return value;
        }

        private static void SkipWhitespace(string s, ref int i)
        {
            while (i < s.Length && (s[i] == ' ' || s[i] == '\t' || s[i] == '\n' || s[i] == '\r')) i++;
        }

        private static JsonValue ParseValue(string s, ref int i)
        {
            SkipWhitespace(s, ref i);
            if (i >= s.Length) throw new FormatException("Unexpected end of JSON");

            char c = s[i];
            if (c == '{') return ParseObject(s, ref i);
            if (c == '[') return ParseArray(s, ref i);
            if (c == '"') return new JsonString(ParseString(s, ref i));
            if (c == 't' || c == 'f' || c == 'n') return ParseLiteral(s, ref i);
            return ParseNumber(s, ref i);
        }

        private static JsonValue ParseObject(string s, ref int i)
        {
            JsonObject obj = new JsonObject();
            i++; // {
            SkipWhitespace(s, ref i);
            if (i < s.Length && s[i] == '}') { i++; return obj; }

            while (true)
            {
                SkipWhitespace(s, ref i);
                string key = ParseString(s, ref i);
                SkipWhitespace(s, ref i);
                if (s[i] != ':') throw new FormatException("Expected ':' in JSON object");
                i++;
                obj.Set(key, ParseValue(s, ref i));
                SkipWhitespace(s, ref i);
                if (s[i] == ',') { i++; continue; }
                if (s[i] == '}') { i++; return obj; }
                throw new FormatException("Expected ',' or '}' in JSON object");
            }
        }

        private static JsonValue ParseArray(string s, ref int i)
        {
            JsonArray arr = new JsonArray();
            i++; // [
            SkipWhitespace(s, ref i);
            if (i < s.Length && s[i] == ']') { i++; return arr; }

            while (true)
            {
                arr.Items.Add(ParseValue(s, ref i));
                SkipWhitespace(s, ref i);
                if (s[i] == ',') { i++; continue; }
                if (s[i] == ']') { i++; return arr; }
                throw new FormatException("Expected ',' or ']' in JSON array");
            }
        }

        private static string ParseString(string s, ref int i)
        {
            if (s[i] != '"') throw new FormatException("Expected string in JSON");
            i++;
            StringBuilder sb = new StringBuilder();
            while (true)
            {
                char c = s[i++];
                if (c == '"') return sb.ToString();
                if (c != '\\') { sb.Append(c); continue; }

                char esc = s[i++];
                switch (esc)
                {
                    case '"': sb.Append('"'); break;
                    case '\\': sb.Append('\\'); break;
                    case '/': sb.Append('/'); break;
                    case 'b': sb.Append('\b'); break;
                    case 'f': sb.Append('\f'); break;
                    case 'n': sb.Append('\n'); break;
                    case 'r': sb.Append('\r'); break;
                    case 't': sb.Append('\t'); break;
                    case 'u':
                        sb.Append((char)int.Parse(s.Substring(i, 4), NumberStyles.HexNumber, CultureInfo.InvariantCulture));
                        i += 4;
                        break;
                    default: throw new FormatException("Bad escape in JSON string");
                }
            }
        }

        private static JsonValue ParseLiteral(string s, ref int i)
        {
            foreach (string word in new[] { "true", "false", "null" })
            {
                if (i + word.Length <= s.Length && string.CompareOrdinal(s, i, word, 0, word.Length) == 0)
                {
                    i += word.Length;
                    return new JsonLiteral(word);
                }
            }
            throw new FormatException("Bad literal in JSON");
        }

        private static JsonValue ParseNumber(string s, ref int i)
        {
            int start = i;
            while (i < s.Length && "+-0123456789.eE".IndexOf(s[i]) >= 0) i++;
            string raw = s.Substring(start, i - start);
            return new JsonNumber(raw, double.Parse(raw, CultureInfo.InvariantCulture));
        }

        /// <summary>
        /// Strip insignificant whitespace without touching string contents.
        /// Used to shrink the dictionaries Figma ships pretty-printed; safer than
        /// a parse/re-serialise round trip because escapes are never rewritten.
        /// </summary>
        public static string Minify(string json)
        {
            StringBuilder sb = new StringBuilder(json.Length);
            bool inString = false;
            for (int i = 0; i < json.Length; i++)
            {
                char c = json[i];
                if (inString)
                {
                    sb.Append(c);
                    if (c == '\\' && i + 1 < json.Length) { sb.Append(json[++i]); continue; }
                    if (c == '"') inString = false;
                    continue;
                }
                if (c == '"') { inString = true; sb.Append(c); continue; }
                if (c == ' ' || c == '\t' || c == '\n' || c == '\r') continue;
                sb.Append(c);
            }
            return sb.ToString();
        }
    }
}
