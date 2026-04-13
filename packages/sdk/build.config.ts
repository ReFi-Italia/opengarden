import { defineBuildConfig } from "unbuild";

export default defineBuildConfig({
	entries: ["src/index"],
	declaration: true,
	rollup: {
		emitCJS: true,
		output: {
			preserveModules: true,
			preserveModulesRoot: "src",
		},
	},
	externals: ["ethers", "@ethereum-attestation-service/eas-sdk"],
});
