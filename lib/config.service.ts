import type { RootConfigService } from "./root-config.service.js";

export class ConfigService<Config extends object> {
	private readonly allowedKeys: ReadonlySet<keyof Config>;

	constructor(
		private readonly root: RootConfigService<Config>,
		keys: readonly (keyof Config)[],
	) {
		this.allowedKeys = new Set(keys);
	}

	get(): Readonly<Config>;
	get<Key extends keyof Config>(key: Key): Config[Key];
	get<Key extends keyof Config>(key?: Key): Readonly<Config> | Config[Key] {
		if (key === undefined) {
			return Object.freeze(
				Object.fromEntries(
					Array.from(this.allowedKeys, (allowedKey) => [
						allowedKey,
						this.root.get(allowedKey),
					]),
				),
			) as Readonly<Config>;
		}

		if (!this.allowedKeys.has(key)) {
			throw new Error(
				`Configuration key "${String(key)}" is not allowed in this scope`,
			);
		}

		return this.root.get(key);
	}
}
