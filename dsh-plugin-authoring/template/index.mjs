// __PKG__ — host half.
//
// Intentionally inert. Every behaviour of this plugin lives in the browser
// half, lib/client.js.
//
// Why a host half exists at all: the DSH client-modules scanner only publishes
// a browser bundle for packages that are *enabled Loader entries*
// (cordis.patch.yml below). There is no client-only plugin.
//
// Persistence note: this template stores state in the browser's localStorage,
// the same approach the official sidebar-right / conversation view-state uses.
// To make state survive a browser switch, give the entry below a Config with
// one `.volatile()` JSON string and read it from the browser half through
// `ctx.configForms.get('__ID__')`.

const name = '__ID__'
const inject = []

/**
 * Report that the host half is composed; the browser half does the work.
 * @param ctx Host plugin context.
 */
function apply(ctx) {
  ctx.logger.info('__PKG__: host half is inert; lib/client.js provides the UI')
}

export { apply, inject, name }
