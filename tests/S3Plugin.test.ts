import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  DefaultPluginManager,
  LocalFolderPluginRepository,
  NpmPluginRepository,
} from "@flowscripter/dynamic-plugin-framework";
import {
  type IOProviderFactory,
  PLUGGABLE_IO_FRAMEWORK_PROVIDER_FACTORY_EXTENSION_POINT,
  PayloadKind,
} from "@flowscripter/pluggable-io-framework-api";
import packageJson from "../package.json";
import s3Plugin from "../src/S3Plugin.ts";
import { s3IOProviderFactory } from "../src/S3IOProviderFactory.ts";

const packageRoot = resolve(import.meta.dir, "..");
const PACKAGE_JSON_NAMESPACE = "pluggable-io-framework";

describe("s3Plugin", () => {
  test("registers the s3 provider factory on the provider factory extension point", async () => {
    const [descriptor] = s3Plugin.extensionDescriptors;
    expect(descriptor?.extensionPoint).toBe(
      PLUGGABLE_IO_FRAMEWORK_PROVIDER_FACTORY_EXTENSION_POINT,
    );
    expect(await descriptor?.factory.create()).toBe(s3IOProviderFactory);
  });
});

describe("dynamic loading via dynamic-plugin-framework", () => {
  const bundlePath = join(packageRoot, "dist", "bundle.js");
  let pluginFolder: string;
  let repository: LocalFolderPluginRepository;

  beforeAll(async () => {
    // Build the real bundle so this test proves loading actual compiled/minified
    // output through dynamic-plugin-framework's import(), not just source via tsc.
    const build = Bun.spawnSync(
      [
        "bun",
        "build",
        "index.ts",
        "--outdir",
        "./dist",
        "--entry-naming",
        "bundle.js",
        "--target",
        "bun",
        "--minify",
        "--external",
        "@flowscripter/dynamic-plugin-framework",
      ],
      { cwd: packageRoot },
    );
    if (build.exitCode !== 0) {
      throw new Error(`Plugin bundle build failed: ${build.stderr.toString()}`);
    }

    pluginFolder = await mkdtemp(join(tmpdir(), "io-plugin-s3-repo-"));
    repository = new LocalFolderPluginRepository(pluginFolder, "manifest.json");
    await repository.writeManifest([
      {
        pluginId: "io-plugin-s3",
        bundlePath,
        extensionPoints: [PLUGGABLE_IO_FRAMEWORK_PROVIDER_FACTORY_EXTENSION_POINT],
        name: "io-plugin-s3",
        version: "0.1.0",
      },
    ]);
  });

  afterAll(async () => {
    await rm(pluginFolder, { recursive: true, force: true });
  });

  test("discovers and instantiates the s3 provider factory through a real import()", async () => {
    const pluginManager = new DefaultPluginManager([repository]);
    await pluginManager.registerExtensions(PLUGGABLE_IO_FRAMEWORK_PROVIDER_FACTORY_EXTENSION_POINT);

    const extensions = await pluginManager.getRegisteredExtensions(
      PLUGGABLE_IO_FRAMEWORK_PROVIDER_FACTORY_EXTENSION_POINT,
    );
    expect(extensions.length).toBe(1);

    const factory = (await pluginManager.instantiate(
      extensions[0]!.extensionHandle,
    )) as IOProviderFactory;
    expect(typeof factory.createProvider).toBe("function");

    expect(factory.protocol).toBe("s3");
    const config = factory.configSchema.parse({ bucket: "media", region: "us-east-1" });
    const provider = await factory.createProvider(config, {
      resolver: { createProviderForLocation: () => Promise.reject(new Error("not used")) },
    });
    expect(provider.kind).toBe(PayloadKind.Js);

    await provider[Symbol.asyncDispose]();
  });
});

describe("NpmPluginRepository discovery", () => {
  let nodeModulesPath: string;

  beforeAll(async () => {
    // Simulate what `dynamic-cli-framework`'s plugin service installs into a
    // consumer CLI's local plugin store: a scoped package directory inside
    // some nodeModulesPath, discoverable by NpmPluginRepository without any
    // npm install/publish involved.
    nodeModulesPath = await mkdtemp(join(tmpdir(), "io-plugin-s3-npm-repo-test-"));
    await mkdir(join(nodeModulesPath, "@flowscripter"), { recursive: true });
    await symlink(packageRoot, join(nodeModulesPath, "@flowscripter", "io-plugin-s3"), "junction");
  });

  afterAll(async () => {
    await rm(nodeModulesPath, { recursive: true, force: true });
  });

  test("discovers and instantiates the provider factory via the packageJsonNamespace field", async () => {
    const repository = new NpmPluginRepository({
      nodeModulesPath,
      packageJsonNamespace: "pluggable-io-framework",
    });

    const pluginManager = new DefaultPluginManager([repository]);
    await pluginManager.registerExtensions(PLUGGABLE_IO_FRAMEWORK_PROVIDER_FACTORY_EXTENSION_POINT);
    const extensions = await pluginManager.getRegisteredExtensions(
      PLUGGABLE_IO_FRAMEWORK_PROVIDER_FACTORY_EXTENSION_POINT,
    );
    expect(extensions.length).toBe(1);

    const factory = (await pluginManager.instantiate(
      extensions[0]!.extensionHandle,
    )) as IOProviderFactory;
    expect(typeof factory.createProvider).toBe("function");
  });
});

describe("package.json plugin discovery metadata", () => {
  // NpmjsPluginRepository.getPlugin() (used by dynamic-cli-framework's
  // `plugin:add`/checkAvailable against the real npm registry) requires
  // BOTH of these independently - it gates on `keywords` including the
  // packageJsonNamespace before it will even look at the namespace field.
  // NpmPluginRepository (local node_modules scan) only checks the
  // namespace field, so a local-only test can't catch a missing keyword.
  test("keywords includes the packageJsonNamespace", () => {
    expect(packageJson.keywords).toContain(PACKAGE_JSON_NAMESPACE);
  });

  test("declares extensionPoints under the packageJsonNamespace field", () => {
    const namespaceData = (
      packageJson as unknown as Record<string, { extensionPoints?: string[] }>
    )[PACKAGE_JSON_NAMESPACE];
    expect(namespaceData?.extensionPoints?.length).toBeGreaterThan(0);
  });
});
