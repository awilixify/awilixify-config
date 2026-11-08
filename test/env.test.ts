import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RootConfigService } from "../index.js";

vi.mock("node:fs", async (importOriginal) => {
	const fs = await importOriginal<typeof import("node:fs")>();
	return { ...fs, readFileSync: vi.fn(fs.readFileSync) };
});

beforeEach(() => {
	vi.mocked(readFileSync).mockReset();
});

describe("RootConfigService construction", () => {
	it("keeps environment values as strings when validation is omitted", () => {
		vi.mocked(readFileSync).mockReturnValueOnce("PORT=3000");
		const config = new RootConfigService({ ignoreEnvVars: true });
		expect(config.get("PORT")).toBe("3000");
		expect(Object.isFrozen(config.get())).toBe(true);
	});
	it("reads .env and validates synchronously by default", () => {
		vi.mocked(readFileSync).mockReturnValueOnce("PORT=3000");
		const validate = vi.fn((env: Record<string, string | undefined>) => ({
			port: Number(env.PORT),
		}));
		const config = new RootConfigService({ ignoreEnvVars: true, validate });
		expect(config.get()).toEqual({ port: 3000 });
		expect(validate).toHaveBeenCalledExactlyOnceWith({ PORT: "3000" });
		expect(readFileSync).toHaveBeenCalledExactlyOnceWith(".env", "utf8");
	});

	it("does not read files for an empty path list", () => {
		const config = new RootConfigService({
			envFilePath: [],
			ignoreEnvVars: true,
			validate: (env) => env,
		});
		expect(config.get()).toEqual({});
		expect(readFileSync).not.toHaveBeenCalled();
	});

	it("does not hide permissions errors", () => {
		const error = Object.assign(new Error("Permission denied"), {
			code: "EACCES",
		});
		vi.mocked(readFileSync).mockImplementationOnce(() => {
			throw error;
		});
		expect(() => new RootConfigService({ validate: (env) => env })).toThrow(
			error,
		);
	});

	it("propagates validation errors from the constructor", () => {
		const error = new Error("Invalid PORT");
		expect(
			() =>
				new RootConfigService({
					ignoreEnvFile: true,
					validate: () => {
						throw error;
					},
				}),
		).toThrow(error);
	});
});
