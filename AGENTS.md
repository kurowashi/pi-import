# AGENTS.md — pi-import で作業するエージェント向けの指示

読者は pi-import を変更する AI エージェントと開発者です。利用者向けの仕様は README に、
設計の判断基準は DESIGN.md と PHILOSOPHY.md(このプラグイン群共通)に書きます。

ここには、壊してはいけない制約と、制約に触れる変更の手順だけを書きます。制約の正はテストで、
下の表はその索引です。実装と表が食い違った場合はテストが正です。検証手段を併記できないものは制約として書かず、
自動テストできない範囲は末尾に分けます。

## 完了条件

`npm run verify`(= `npm run check` + `npm run knip` + `npm test` + `npm run test:coverage`)が通ること。
フックが通っても CI が通らなければ未完了。CI は同じ `verify` を Node 22.19 / 24 で実行します。
カバレッジは `test/unit` と `test/integration` で計測します。下の表の「検証」列は個別の検証箇所であり、
自動検証はすべて `verify` に含まれます。

## 制約

### フック面

| 制約 | 検証 | 定義・実装箇所 |
|---|---|---|
| モデル向けのツールを登録しない(注入専用) | `test/contract/surface.test.ts` | `src/index.ts` |
| コマンド・ショートカット・フラグを登録しない | `test/contract/surface.test.ts` | `src/index.ts` |
| イベントは `session_start` / `before_agent_start` の2種で、各1ハンドラ | `test/contract/surface.test.ts` | `test/contract/surface.test.ts` の `EXPECTED_EVENTS` |

### プロンプト形式

| 制約 | 検証 | 定義・実装箇所 |
|---|---|---|
| 固定文は Claude Code 2.1.287 と同一 | `test/unit/format.test.ts` | `src/format.ts` の `MEMORY_PROMPT` |
| ファイルごとに `Contents of {path}{説明文}:` の後に空行と trim 済み本文を置く | `test/unit/format.test.ts` | `src/format.ts` の `formatMemory` |
| ファイル間は `\n\n` で連結し、末尾改行を付けない | `test/unit/format.test.ts` | `src/format.ts` の `formatMemory` |
| 説明文は project が `(project instructions, checked into the codebase)`、user が `(user's private global instructions for all projects)` | `test/unit/format.test.ts` | `src/format.ts` の `DESCRIPTION` |
| `wrapper: "system-reminder"` は `<system-reminder>\n...\n</system-reminder>` で包む。`"none"` は包まない | `test/unit/format.test.ts` | `src/format.ts` の `wrapMemory` |
| `project_context` は import が1つ以上解決したときだけ置き換える。0件なら触らない | `test/integration/extension.test.ts` | `src/index.ts` の `before_agent_start` |
| `enabled: false` はセクションを変更しない | `test/integration/extension.test.ts` | `src/index.ts` |

### 展開規則

| 制約 | 検証 | 定義・実装箇所 |
|---|---|---|
| 抽出は `(?:^|\s)@((?:[^\s\\]|\\ )+)` で、`@` の直前は行頭か空白のみ | `test/unit/scan.test.ts` | `src/scan.ts` の `IMPORT` |
| `#fragment` を除き、`\ ` を空白に戻す | `test/unit/scan.test.ts` | `src/scan.ts` の `extractCandidates` |
| `./` / `~/` / `/` / 英数字始まりのみ有効。引用符付きは展開しない | `test/unit/scan.test.ts` | `src/scan.ts` の `isValidImportPath` |
| コードスパンとフェンスコードブロック内は展開しない | `test/unit/scan.test.ts` | `src/scan.ts` |
| 行頭 HTML コメント内は展開しない。コメント後の残留テキストは展開する | `test/unit/scan.test.ts` | `src/scan.ts` |
| frontmatter 内は展開せず、注入本文からも除く | `test/unit/scan.test.ts` | `src/scan.ts` の `stripFrontmatter` |
| 相対パスは import を書いたファイルのディレクトリ基準。`~/` はホーム | `test/unit/expand.test.ts` | `src/expand.ts` の `resolveImportPath` |
| 4 ホップまで展開する(親を depth 0、depth 5 は読まない) | `test/unit/expand.test.ts` | `src/expand.ts` の `MAX_DEPTH` |
| realpath でグローバルに重複排除し、循環を止める | `test/unit/expand.test.ts` | `src/expand.ts` の `canonicalKey` |
| 順序は親 → import の深さ優先(記述順) | `test/unit/expand.test.ts` | `src/expand.ts` の `visit` |
| import は親の種別(user / project)を継承する | `test/unit/expand.test.ts` | `src/expand.ts` の `visit` |
| agent dir 直下の context file は user、それ以外は project | `test/unit/expand.test.ts` | `src/expand.ts` の `typeOf` |
| 拡張子は Claude Code の許可リストのみ。拡張子なしは許可 | `test/unit/expand.test.ts` | `src/expand.ts` の `TEXT_EXTENSIONS` と `isTextFile` |
| 4 MiB 超・空・ディレクトリ・読み取り不能は黙ってスキップ | `test/unit/expand.test.ts` | `src/expand.ts` の `readTextFile` |

### 設定

| 制約 | 検証 | 定義・実装箇所 |
|---|---|---|
| グローバルは `getAgentDir()` 相当の `pi-import.json`、プロジェクトは `<cwd>/.pi/pi-import.json` | `test/unit/config.test.ts` | `src/config.ts` |
| プロジェクトは trusted のときだけ読み、フィールド単位で上書きする | `test/unit/config.test.ts` | `src/config.ts` の `loadImportConfig` |
| 壊れた JSON・不正値は既定値で動き、警告を出す。未知キーは無視する | `test/unit/config.test.ts` | `src/config.ts` の `resolveConfig` と `readConfigFile` |
| 警告は `session_start` で1回通知する | `test/integration/extension.test.ts` | `src/index.ts` の `reload` |

### 依存関係・import

| 制約 | 検証 | 定義・実装箇所 |
|---|---|---|
| 実行時依存を持たない(`dependencies` は空) | `test/contract/dependencies.test.ts` | `package.json` |
| `src` の import は node builtin・相対 `.ts`・Pi 提供パッケージのみ | `test/contract/dependencies.test.ts` | `test/contract/dependencies.test.ts` の `ALLOWED_PEER_DEPENDENCIES` |
| 循環依存を作らない | `npx biome check .` | `biome.jsonc` の `noImportCycles` |
| 未宣言の依存を import しない(import 元パッケージの `package.json` へ先に宣言する) | `npx biome check .` | `biome.jsonc` の `noUndeclaredDependencies` |
| 未使用の export・依存・ファイルを検出しない | `npm run knip` | `knip.jsonc` |
| devDependency は allowlist 内のみ | `test/contract/dependencies.test.ts` | `test/contract/dependencies.test.ts` の `ALLOWED_DEV_DEPENDENCIES` |

### 配布・ビルド

| 制約 | 検証 | 定義・実装箇所 |
|---|---|---|
| 配布物は `files` の whitelist 内のみ | `test/ci/package-contents.test.ts` | `package.json` の `files` |
| `pi.extensions` のエントリが配布物に含まれる | `test/ci/package-contents.test.ts` | `package.json` の `pi.extensions` |
| ビルド工程を持たない(TS を直接配布) | `test/ci/package-contents.test.ts` | `package.json`(`build` script なし、`pi.extensions` が `./src/index.ts`) |

### コード品質

| 制約 | 検証 | 定義・実装箇所 |
|---|---|---|
| `enum` / `namespace` / parameter properties を使わない | `npx tsc --noEmit` | `tsconfig.json` の `erasableSyntaxOnly` |
| 型は `any` なし、非null断言なし、浮いた Promise なし | `npx biome check .` | `biome.jsonc` の `suspicious` / `nursery` |
| `console` を使わない | `npx biome check .` | `biome.jsonc` |
| 認知複雑度は 12 以下 | `npx biome check .` | `biome.jsonc` の `noExcessiveCognitiveComplexity` |
| 相対 import は `.ts` 拡張子付き、パスエイリアスなし | `npx tsc --noEmit` + Node 実行 | `tsconfig.json` |

## 変更時の手順

- プロンプトの文言や wrapper を変える場合は `test/unit/format.test.ts` の golden 値を先に更新する。
  モデルが見る文字列そのものなので、テストが変更の入口になる。
- 抽出・解決の規則を変える場合は `test/unit/scan.test.ts` と `test/unit/expand.test.ts` を先に更新する。
  Claude Code との差分は DESIGN.md の「スキャナの限定」に反映する。
- イベントや登録物を増減する場合は `test/contract/surface.test.ts` の `EXPECTED_EVENTS` を先に更新する。
  1つ落とすと機能が静かに消えるため、契約が変更の入口になる。
- 依存を追加する場合は devDependency のみ可能。`ALLOWED_DEV_DEPENDENCIES` の更新とコミットメッセージの理由をセットで行う。
  実行時依存(`dependencies`)の追加は不可。
- ドキュメントの段落内の改行は、文末(。！？)・読点(、)・コロン(:)の直後に置く。

## 手動確認項目(自動検証の対象外)

前提: TUI と実モデルのセッションで確認します。

1. `AGENTS.md` に `@child.md` を書き、実 Pi セッションの system message に
   `Contents of ...` が親 → import の順で入ること。
2. `wrapper` が `"system-reminder"` と `"none"` の両方で、期待どおりタグが付く/付かないこと。
3. 設定ファイルを編集して `/reload` すると新しい値が反映されること。壊れた JSON でもセッションが止まらないこと。
