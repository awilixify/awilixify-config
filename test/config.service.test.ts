import { describe, expect, it, vi } from "vitest";
import { ConfigService, RootConfigService } from "../index.js";

describe("scoped ConfigService", () => {
	it("delegates allowed reads and rejects all unselected keys", () => {
		const validate = vi.fn(() => ({ port: 3000, secret: "private" }));
		const root = new RootConfigService({ ignoreEnvFile: true, validate });
		const read = vi.spyOn(root, "get");
		const config = new ConfigService<{ port: number }>(root, ["port"]);
		expect(config.get("port")).toBe(3000);
		expect(read).toHaveBeenCalledWith("port");
		expect(config.get()).toEqual({ port: 3000 });
		expect(Object.isFrozen(config.get())).toBe(true);
		const disallowedRead = () => {
			// @ts-expect-error Unselected keys must throw at runtime too.
			return config.get("secret");
		};
		expect(disallowedRead).toThrow(
			'Configuration key "secret" is not allowed in this scope',
		);
		expect(read).not.toHaveBeenCalledWith("secret");
		expect(validate).toHaveBeenCalledTimes(1);
	});

	it("copies the key selection so callers cannot widen access later", () => {
		const root = new RootConfigService({
			ignoreEnvFile: true,
			validate: () => ({ port: 3000, secret: "private" }),
		});
		const keys: ("port" | "secret")[] = ["port"];
		const config = new ConfigService(root, keys);
		keys.push("secret");
		expect(() => config.get("secret")).toThrow("not allowed");
		expect(config.get()).toEqual({ port: 3000 });
	});

	it("allows absent optional keys but throws for an empty scope", () => {
		const root = new RootConfigService({
			ignoreEnvFile: true,
			validate: (): { token?: string } => ({}),
		});
		const config = new ConfigService(root, ["token"]);
		expect(config.get("token")).toBeUndefined();
		const empty = new ConfigService(root, []);
		expect(empty.get()).toEqual({});
		expect(() => empty.get("token")).toThrow("not allowed");
	});
});
