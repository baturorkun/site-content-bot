# site-content-bot

What the package does, in one sentence.

## Install

```sh
npm install site-content-bot
npx site-content-bot --help
```

## Usage

```js
import { greet } from 'site-content-bot';

greet('Ada'); // 'Hello, Ada!'
```

## Publishing

A version is published by its tag, from `.github/workflows/publish.yml`:

1. Set `version` in `package.json`, commit, and push.
2. Tag that commit `v<version>` and push the tag. The workflow checks that the tag is the
   `package.json` version, runs the type check, the tests, the build and the pack check, and
   publishes with provenance. Run by hand, it is a dry run.

Set up once, either:

- **Trusted publishing** (no token): on npmjs.com, the package's Settings > Trusted publishing,
  this GitHub repository and the workflow `publish.yml`. The package has to exist, so the very
  first version may have to be published by hand (`npm publish --access public`).
- **A token**: an npm automation (or granular) token as the repository secret `NPM_TOKEN`.

Set `repository` in `package.json` to this GitHub repository: npm provenance checks it.

## License

MIT
