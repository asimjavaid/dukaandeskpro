#!/usr/bin/env python3
"""Add English UI strings: python3 tools/dev/add-i18n.py key='Text' key2='Text 2' ...  (skips keys that exist)."""
import sys, re, os
p = os.path.join(os.path.dirname(__file__), '../../apps/web/src/i18n/dictionary.ts')
s = open(p, encoding='utf-8').read()
union_end = s.index('export const dictionary')
en_start = s.index('\n  en: {')
for arg in sys.argv[1:]:
    k, v = arg.split('=', 1)
    if re.search(r"\| '%s'\n" % re.escape(k), s[:union_end]):
        continue
    # union: insert before the ';' that ends the MessageKey type
    last = s.rindex("\n  | '", 0, s.index('export const dictionary'))
    eol = s.index('\n', last + 1)
    s = s[:eol] + "\n  | '%s'" % k + s[eol:]
    en_start = s.index('\n  en: {')
    ins = s.index('\n', en_start + 1)
    s = s[:ins] + "\n    %s: %s," % (k, repr(v) if "'" not in v else '"%s"' % v) + s[ins:]
    union_end = s.index('export const dictionary')
open(p, 'w', encoding='utf-8').write(s)
