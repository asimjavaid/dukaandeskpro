// Colour theme before first paint (A / B / C, per PC). A file, not inline, so the strict CSP allows it.
try { var t = localStorage.getItem('dd-theme'); document.documentElement.setAttribute('data-theme', t === 'a' || t === 'c' ? t : 'b'); } catch (e) { document.documentElement.setAttribute('data-theme', 'b'); }
