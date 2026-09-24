/* ============================================
   JSX STRING ESCAPER (pure, Node-exportable)
   --------------------------------------------
   Every evalScript call builds ExtendScript
   source like  fn('<value>').  Paths such as
   "John's Edit" or comp names with quotes must
   be escaped or the call silently breaks.
   Use jsxString() for every interpolated arg.
   ============================================ */
(function () {
    'use strict';

    // Unicode line/paragraph separators end a string literal in ES3 ExtendScript.
    var LS = String.fromCharCode(0x2028);
    var PS = String.fromCharCode(0x2029);

    // Escape a value for use inside a single-quoted ExtendScript string literal.
    function escapeJsx(value) {
        return String(value == null ? '' : value)
            .replace(/\\/g, '\\\\')
            .replace(/'/g, "\\'")
            .replace(/\r/g, '\\r')
            .replace(/\n/g, '\\n')
            .split(LS).join('\\' + 'u2028')
            .split(PS).join('\\' + 'u2029');
    }

    // Quoted literal, ready to drop into a call: `fn(${jsxString(p)})`
    function jsxString(value) {
        return "'" + escapeJsx(value) + "'";
    }

    var JsxEscape = { escapeJsx: escapeJsx, jsxString: jsxString };
    if (typeof module !== 'undefined' && module.exports) module.exports = JsxEscape;
    if (typeof window !== 'undefined') window.JsxEscape = JsxEscape;
    else if (typeof globalThis !== 'undefined') globalThis.JsxEscape = JsxEscape;
})();
