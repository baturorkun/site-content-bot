// content-bot.config.mjs: how this site describes itself to site-content-bot.
// Everything about the *site* is here; where the bot runs and its secrets are
// in tools/content-bot/.env on the host (see .env.example). Read once, when
// the bot starts: a change here takes effect on its restart.
export default {
  // How the page names the site and the bot. Only name is required: mark
  // defaults to the name's initials, title to "Content Bot", subtitle to
  // "The <name>'s texts".
  brand: { mark: 'EX', name: 'Example site', title: 'Content Bot', subtitle: "The Example site's texts" },

  // What the bot may change, and nothing else. Each entry names one file
  // (path) or a pattern (glob: * within a path segment, ** across segments).
  //   kind 'text':     any text in the file, under the rule in `rule`, which
  //                    goes to the model word for word.
  //   kind 'svg-text': the text inside <text> and <tspan> elements only; the
  //                    drawing's markup may not change (its rule is fixed).
  editable: [
    {
      path: 'src/content/texts.ts',
      kind: 'text',
      rule: 'the text inside string literals (content.tr is Turkish, content.en English); never keys, types, imports, paths, functions or the structure of the file; keep the TypeScript valid (escape quotes as the file does)',
    },
    { glob: 'public/**/*.svg', kind: 'svg-text' },
  ],

  // One line for the model: where the rest of the site is, for questions.
  layout: 'layout, code and styles: src/, public/index.html',

  // Left out of the copies the model reads (default: runs, handoffs, .factory).
  exclude: ['runs', 'handoffs', '.factory'],

  // How a copy of main becomes what the test domain serves. The command runs
  // in that copy with CLONE set to the bot's clone (whose node_modules it may
  // use, as here); output is the directory it leaves; describe tells the model
  // what is in it.
  build: {
    command: 'npm --prefix "$CLONE" ci >/dev/null && ln -s "$CLONE/node_modules" node_modules && npm run build >/dev/null',
    output: 'dist',
    describe: 'index.html (English), tr/index.html (Turkish), assets/',
  },

  // The site's checks, run in the clone before a push; a failure pushes nothing.
  checks: 'npm ci >/dev/null && npm test',

  // The next release's version, fixed, not chosen:
  //   'aifactory'  1.<last completed requirement>.<its run id> (the default)
  //   'patch'      production's version with the patch number raised
  //   a function   ({ candidate, production, read }) => 'MAJOR.MINOR.PATCH',
  //                read(path) giving a file of the candidate commit, e.g.
  //                async ({ read }) => JSON.parse(await read('package.json')).version
  version: 'aifactory',

  // What the test domain and production serve, for the page and the model.
  urls: { test: 'https://test.example.com', production: 'https://www.example.com' },
};
