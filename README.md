# pi-import

Claude Code の `@path` ファイル注入を Pi で再現する Pi 拡張です。Pi が読み込む context file（`AGENTS.md` / `CLAUDE.md` / `AGENTS.override.md`）に `@docs/conventions.md` と書くと、そのファイルを展開し、Claude Code 2.1.287 と同一のメモリ本文を `project_context` セクションに注入します。

`enabled` が有効で、`@` 参照が1つ以上解決したときだけ `project_context` を置き換えます。それ以外は Pi の既定動作のままです。

```mermaid
flowchart LR
  A[Pi が context file をロード] --> B{enabled か?}
  B -- いいえ --> C[Pi 既定の project_context]
  B -- はい --> D{@ 参照が解決した?}
  D -- いいえ --> C
  D -- はい --> E[Claude Code 形式のメモリ本文に置き換え]
```

注入例:

```text
AGENTS.md                          プロンプトの project_context セクション
---------------------------------  ----------------------------------------------
# プロジェクト指示                Codebase and user instructions are shown below.
@docs/conventions.md
@package.json                      Contents of /repo/AGENTS.md (project instructions, checked into the codebase):
                                   # プロジェクト指示
                                   @docs/conventions.md
                                   @package.json

                                   Contents of /repo/docs/conventions.md (project instructions, checked into the codebase):
                                   ...
```

## 動作要件

- Pi 1.0 以上（`before_agent_start` の `systemPromptOptions.contextFiles` と `sections` を使います）
- Node.js 22.19 以上（Pi 本体と同じ）

## インストール

```bash
pi install git:github.com/kurowashi/pi-import
```

ref を固定する場合は `pi install git:github.com/kurowashi/pi-import@<tag|commit>`。

ローカルの作業コピーを使う場合:

```bash
pi install /path/to/pi-import
```

または直接読み込み:

```bash
pi --extension /path/to/pi-import/src/index.ts
```

## 設定

設定ファイルは2つあり、プロジェクト側がフィールド単位で上書きします。

| ファイル | 読む条件 |
|---|---|
| `~/.pi/agent/pi-import.json`（`$PI_CODING_AGENT_DIR` があればその下） | 常に |
| `<cwd>/.pi/pi-import.json` | プロジェクトが trusted のときのみ |

trusted は Pi が初回起動時に確認するプロジェクトの信頼設定です（Pi 本体の `/trust` で確認・変更できます）。trusted でないときもグローバル設定は読み込みます。

```json
{
  "enabled": true,
  "wrapper": "system-reminder"
}
```

| キー | 値 | 既定 |
|---|---|---|
| `enabled` | `true` / `false` | `true` |
| `wrapper` | `"system-reminder"` / `"none"` | `"system-reminder"` |

- `enabled: false` のときは何もしません（Pi 既定の表示のまま）。
- `wrapper` はメモリ本文を `<system-reminder>` で包むかどうかです。`"system-reminder"` が Claude Code 2.1.287 と同じ形式で、`"none"` は包みません。

設定例は [`examples/pi-import.example.json`](examples/pi-import.example.json) にあります。

設定は `session_start`（`/reload` を含む）のときに読み込みます。不正なファイル全体（JSON エラー・オブジェクト以外）はそのファイルを無視し、他のファイルの値はそのまま使います。不正なフィールドは、マージ後の値が不正になるため、下位ファイルに有効な値があっても既定値に戻ります。警告は UI があるとき（TUI / RPC）に `session_start` ごとに表示します。未知のキーは無視します。

セッション中に設定ファイル、context file、import 先ファイルを変更した場合は `/reload` で再読込します。

## 記法

`@` の直後にパスを書きます。`@` の直前は行頭か空白である必要があります。パスは `./`、`~/`、`/` のいずれか、または英数字・`.`・`_`・`-` で始まる必要があります（`../x.md` や拡張子なしのファイル名も有効です）。`/` 単体は無効です。

| 書き方 | 解決先 |
|---|---|
| `@docs/a.md` | そのファイルがあるディレクトリ基準の相対パス |
| `@./docs/a.md` | 同上 |
| `@~/notes/a.md` | ホームディレクトリ |
| `@/etc/hosts` | 絶対パス |

- パスに空白を含める場合は `\ ` とエスケープします（例: `@Design\ Docs/api.md`）。引用符で囲むと展開されません。
- `@a.md#section` の `#section` は無視し、ファイル全体を読み込みます。
- `@README` のように拡張子のないファイルも読み込めます。
- パスは空白までを取り込むため、直後に空白がないと文末の記号（`.`、`,`、`)` など）もパスに含まれます。文末に書く場合はパスの後に空白を入れてください。

展開しない場所:

- インラインコード（`` `@README` ``）とフェンスコードブロック
- 行頭の HTML コメント（`<!-- @a.md -->`）
- 先頭の `---` で閉じられた YAML frontmatter（展開せず、注入本文からも除去します。閉じていない場合は本文として扱います）

読み込みの制限:

| 制限 | 値 |
|---|---|
| 再帰の深さ | 4 ホップまで |
| ファイルサイズ | 4 MiB まで |
| 拡張子 | Claude Code と同じ許可リスト。拡張子なしは許可 |
| 重複 | 解決したパスごとにセッション内で1回だけ。循環もここで停止 |

許可される拡張子の例は `.md`、`.txt`、`.json`、`.yaml`、`.py`、`.ts`、`.js`、`.go`、`.rs` です。完全なリストは Claude Code 2.1.287 と同一で、[src/expand.ts](src/expand.ts) の `TEXT_EXTENSIONS` にあります。

存在しないファイル、ディレクトリ、空ファイル、許可されない拡張子、読み取り不能なファイルは黙ってスキップします。読み込み順は親ファイル → import の深さ優先（記述順）です。

> [!WARNING]
> pi-import は作業ディレクトリ外のパスも承認なしで読み込みます。context file に書かれた import 先が機密ファイルを指していないことを確認してください。

## プロンプト出力

import が1つ以上解決したときだけ、Pi の `project_context` セクションを置き換えます。本文は Claude Code 2.1.287 と同一で、ファイルごとに次の形を `\n\n` で連結し、先頭に固定文を付けます（末尾改行なし）。

```text
Codebase and user instructions are shown below. Be sure to adhere to these instructions. IMPORTANT: These instructions OVERRIDE any default behavior and you MUST follow them exactly as written.

Contents of /repo/AGENTS.md (project instructions, checked into the codebase):

<本文>

Contents of /home/me/.pi/agent/AGENTS.md (user's private global instructions for all projects):

<本文>
```

種別は context file の場所で決まります。agent dir 直下のファイル（通常は `~/.pi/agent/AGENTS.md`）が `user`、それ以外が `project` です。import されたファイルは親の種別を継承します。

実際のプロンプトでは、Pi がセクションを `project_context` タグで包みます。

```text
<project_context>
<system-reminder>
Codebase and user instructions are shown below. ...
</system-reminder>
</project_context>
```

`wrapper` が `"none"` のときは `<system-reminder>` タグが付きません。

## Claude Code との差分

| 項目 | Claude Code 2.1.287 | pi-import |
|---|---|---|
| 外部 import（作業ディレクトリ外） | 初回のみ承認ダイアログ | 承認なしで読み込む |
| frontmatter `paths:` の条件付きルール | `.claude/rules` で対応 | 非対応（常に展開） |
| プロンプト上の位置 | 最初の user メッセージ内の `<system-reminder>` | `project_context` システムプロンプトセクション |
| auto memory / team memory | あり | 非対応（Pi に概念がない） |

スキャナの細かい限定は [DESIGN.md](DESIGN.md) に記載しています。

## 開発

```bash
npm install
npm run verify
```

`verify` は Biome、型チェック、knip、テスト、カバレッジしきい値をまとめて実行します。
