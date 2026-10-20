# Development

Follow [Get started](../../README.md#get-started) for the initial install.
Run commands from the repository root.

## Daily commands

| Command         | Purpose                                                |
| --------------- | ------------------------------------------------------ |
| `vpr dev`       | Start the API and client with reload.                  |
| `vpr check`     | Check formatting, typed lint and types.                |
| `vpr lint:css`  | Check app CSS, theme tokens and roadmap styles.        |
| `vpr format`    | Format the repository.                                 |
| `vpr typecheck` | Check the client, server and test TypeScript projects. |
| `vpr test`      | Run unit, component and integration tests.             |
| `vpr quality`   | Run the full non-browser quality gate and build.       |
| `vpr build`     | Build the client and server.                           |

`package.json` lists all scripts. `vpr` runs a project script, so use `vpr dev`
and `vpr build` for the complete app. The built-in `vp dev` and `vp build` run
only the client.

## Configuration

`vite.config.ts` owns client builds, tests, coverage, lint, formatting and staged
checks. Separate TypeScript projects check client, server and test code.
Playwright and Fallow have their own configuration files.

CSS rules also live in `vite.config.ts`; `stylelint.config.mjs` adapts them for
Stylelint. `vpr lint`, `vpr check`, `vpr quality`, commit/push hooks and CI run
the CSS check. The roadmap uses `postcss-html` to lint its embedded styles.
Oxfmt owns formatting; Stylelint checks CSS validity, duplicate declarations
and selector specificity. Intentional cascades have local, explained exceptions.

`.node-version` selects Node; `package.json` selects the package manager and
`pnpm-workspace.yaml` holds shared dependency pins. Update those files rather
than copying version numbers into documentation.

Installation enables commit hooks. The commit hook formats and checks staged
files. The push hook checks types, affected tests and the Fallow branch audit.
VS Code users can install the recommended workspace extensions. Other editors
can follow the [official integration guide](https://viteplus.dev/guide/ide-integration).

## Working on the app

See the [source map](architecture.md) to find the owning module and
[testing guide](testing.md) for focused suites, browser checks and benchmarks.
Use the [design guide](design.md) for shared UI changes. Update the relevant
user or reference page when behavior changes.
