# @awilixify/config

Typed configuration for Awilixify, with root and module-scoped access. Uses Node.js's native `.env` parser. No dotenv or validation-library dependency.

Requires Node.js 22+.

## Install

```sh
npm install @awilixify/config awilixify awilix
```

## Create the module factory

The application can supply validation and conversion. Its return type determines the configuration type. Throw an error to reject startup. Validation must be synchronous. Without `validate`, configuration defaults to the merged environment, with string values or `undefined` and no conversion.

```ts
import { createConfigModuleFactory } from "@awilixify/config";

export const ConfigModule = createConfigModuleFactory({
  envFilePath: [".env.local", ".env"],
  validate: (env) => {
    const port = Number(env.PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("PORT must be an integer between 1 and 65535");
    }
    if (!env.HOST) throw new Error("HOST is required");

    return {
      host: env.HOST,
      port,
      databaseUrl: env.DATABASE_URL,
    };
  },
});
```

Use any validation library inside `validate`. The package does not automatically convert strings or check application values.

## Root and child modules

Import the factory directly to expose `rootConfig`, a `RootConfigService` with access to every validated key. Call it with `keys` to create a child module exporting `config`, a scoped `ConfigService` restricted to those keys.

```ts
import { createModule, DIContext, type ModuleDef } from "awilixify";
import { ConfigModule } from "./config.js";

const WebConfigModule = ConfigModule({ keys: ["host", "port"] });
type WebDef = ModuleDef<{
  imports: [typeof WebConfigModule];
  providers: { serverAddress: { onInit(): void } };
}>;

const WebModule = createModule<WebDef>({
  name: "WebModule",
  imports: [WebConfigModule],
  providers: {
    serverAddress: {
      inject: ["config"],
      useFactory: (config) => ({
        onInit() {
          console.log(`${config.get("host")}:${config.get("port")}`);
          // config.get("databaseUrl"); // Type error.
        },
      }),
      eager: true,
    },
  },
});

const context = DIContext.create({
  name: "App",
  imports: [ConfigModule, WebModule],
});
await context.init();
// Use the application.
await context.close();
```

A child imports the root automatically. Importing the root at application level is optional. The child does not re-export `rootConfig`.

- `config.get("port")` returns the property's inferred type.
- `config.get()` returns a shallow-frozen, read-only object containing only selected keys.
- An empty `keys` array exposes no configuration values.
- Missing optional properties return `undefined`.

Child services delegate to the shared root service and check every keyed read. Reading an unselected key throws at runtime, even if TypeScript checks are bypassed. `get()` without a key returns a shallow-frozen subset containing only allowed keys. Child services do not reload files or rerun validation. This is dependency scoping, not a security boundary. Nested values retain their original references and are not deeply frozen.

## Loading options

| Option | Default | Behavior |
| --- | --- | --- |
| `envFilePath` | `".env"` | One path or a readonly array of paths, relative to the working directory. Earlier files win. |
| `ignoreEnvFile` | `false` | Skip all file loading. |
| `ignoreEnvVars` | `false` | Exclude `process.env` from validation input. |
| `validate` | Omitted | Receives `Record<string, string \| undefined>` and synchronously returns a typed configuration object. |

Existing `process.env` values override file values unless `ignoreEnvVars` is enabled. An empty string is an existing value and also takes precedence. Missing files are ignored so deployments can use environment variables without a file. Other read errors fail service construction.

Files are parsed using `node:util`'s `parseEnv`, including its support for comments, quoted values and multiline strings. `${VARIABLE}` expansion is not supported. An empty `envFilePath` array skips files.

Loading never writes to `process.env`. `validate` receives a merged copy, and its returned object is shallow-copied and frozen before exposure. Return a plain configuration object.

## Custom provider names

Use distinct names when importing multiple configuration factories:

```ts
const ServiceConfigModule = createConfigModuleFactory({
  rootProviderName: "serviceSettings",
  scopedProviderName: "featureSettings",
  validate: (env) => ({ host: env.HOST }),
});
```

Names must be non-empty string literals. Defaults are `rootConfig` and `config`.

## Lifecycle

Files are read and validation runs synchronously in the `RootConfigService` constructor, once per root module per DI context. This happens on first resolution, or during `await context.init()` if not resolved earlier. Several child modules share the same root service. Each context owns its own services. Configuration is a startup snapshot, not a live view of files or `process.env`.

Configuration is available immediately after service construction, including in dependent constructors and provider factories. File-loading and validation errors throw during construction and reject `context.init()` if construction occurs there.

The package does not augment Awilixify's global dependencies. Import the appropriate module to declare each feature's configuration dependency explicitly.

## Development

```sh
npm ci
npm run build:release
```
