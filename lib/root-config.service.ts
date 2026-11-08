import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";

export type Environment = Record<string, string | undefined>;

type ConfigOptions<Config extends object> = {
	/** Defaults to .env. Earlier files take precedence. Relative to process.cwd(). */
	envFilePath?: string | readonly string[];
	/** Skip file loading. Defaults to false. Missing files are otherwise ignored. */
	ignoreEnvFile?: boolean;
	/** Exclude process.env from validation input. Defaults to false. */
	ignoreEnvVars?: boolean;
	/** Convert and validate the merged environment. Throw to reject startup. */
	validate?: (
		env: Environment,
	) => Config & (Config extends PromiseLike<unknown> ? never : unknown);
};

export type RootConfigServiceOptions<Config extends object = Environment> =
	ConfigOptions<Config> &
		(Environment extends Config
			? unknown
			: Required<Pick<ConfigOptions<Config>, "validate">>);

export class RootConfigService<Config extends object = Environment> {
	private readonly config: Readonly<Config>;

	constructor(private readonly options: RootConfigServiceOptions<Config>) {
		const env = this.loadEnvironment();
		// Without a validator, the options type requires Config to accept Environment.
		const config = options.validate ? options.validate(env) : (env as Config);

		this.config = Object.freeze({ ...config });
	}

	get(): Readonly<Config>;
	get<Key extends keyof Config>(key: Key): Config[Key];
	get<Key extends keyof Config>(
		key?: Key,
	): Readonly<Config> | Config[Key] | undefined {
		if (key === undefined) return this.config;

		return Object.hasOwn(this.config, key) ? this.config[key] : undefined;
	}

	private loadEnvironment(): Environment {
		const paths = this.options.envFilePath ?? ".env";
		const files = this.options.ignoreEnvFile
			? []
			: typeof paths === "string"
				? [paths]
				: paths;

		const env = files.reduce<Environment>((env, path) => {
			try {
				return { ...parseEnv(readFileSync(path, "utf8")), ...env };
			} catch (error) {
				// Missing env files are optional; deployments can supply process.env instead.
				if ((error as NodeJS.ErrnoException).code === "ENOENT") return env;

				throw error;
			}
		}, {});

		return this.options.ignoreEnvVars ? env : { ...env, ...process.env };
	}
}
