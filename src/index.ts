// site-content-bot as a library: what a site, a test or another server needs
// to run the bot or parts of it. The command is cli.ts.
export { GitLabAuth, ACCESS, type User } from './auth.js';
export { ContentBot, ANSWER_SCHEMA, RELEASE_ACCESS, DEFAULT_PLATFORM, type Session, type Proposal, type Releases } from './bot.js';
export { askClaude, ALLOWED_TOOLS, DENIED_TOOLS, NOT_LOGGED_IN, type Ask } from './claude.js';
export { loadConfig, validateConfig, ConfigError, CONFIG_FILE, DEFAULT_EXCLUDE, DEFAULT_DEPLOY, type Config, type EditableEntry, type VersionFunction, type VersionInput } from './config.js';
export { Editable, applyEdits, applyFileEdits, globToRegExp, type Edit } from './edits.js';
export { deployState, latestRelease, lastGreenMain, createRelease, projectReachable, gitlabPlatform } from './gitlab.js';
export { githubPlatform, apiBase, ROLE_LEVEL, GITHUB_ACCESS, githubAccessName } from './github.js';
export { platformOf, createPlatform, PLATFORM_NAMES, type Platform, type PlatformName, type PlatformSettings, type Auth, type DeployState, type Release } from './platform.js';
export { Repo, BOT_TRAILER, type BotChange, type Commit } from './repo.js';
export { createApp, renderPage, PAGE_FILE, type AppOptions, type Login } from './server.js';
export { Site, type Context, type Production } from './site.js';
export { onlyTextChanged, textless, checkSvgEdit } from './svg.js';
export { versionPolicy, versionPolicies, nextVersion, requirementVersion, VERSION, type VersionPolicy, type RequirementVersion } from './version.js';
export { serve, check, init, main } from './commands.js';
