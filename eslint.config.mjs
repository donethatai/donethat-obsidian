// Lints the plugin with the rules the Obsidian community directory's scanner builds on.
import {defineConfig, globalIgnores} from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
  // Build output and the Node build script are not plugin code.
  globalIgnores(["node_modules", "main.js", "esbuild.config.mjs"]),
  ...obsidianmd.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["eslint.config.mjs"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
]);
