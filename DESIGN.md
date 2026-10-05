# 設計思想 — pi-import

読者は pi-import を変更する開発者と AI エージェントです。共通の哲学は [PHILOSOPHY.md](PHILOSOPHY.md)、検証可能な制約と変更手順は [AGENTS.md](AGENTS.md) にあります。

## 目指すべきところ

対象は Pi を使う開発者とエージェントです。Pi は context file（`AGENTS.md` / `CLAUDE.md` など）を読み込んで `project_context` セクションに注入しますが、Claude Code の `@path` ファイル注入は持ちません。目的は、context file に書いた `@path` をそのまま使い、import 先の本文を Claude Code 2.1.287 と同一のメモリ本文として再現することです。

### 達成状態

| 状態 | 観測方法 |
|---|---|
| import 先の本文がプロンプトに入る | 実 Pi セッションの system message に `Contents of ...` が親 → import の順で入る |
| メモリ本文が Claude Code 2.1.287 と一致する | `test/unit/format.test.ts` の golden 値 |
| import が1つ以上解決したときだけ置き換わる | `test/integration/extension.test.ts` |
| 本文を包む形式を設定ファイルで選べる | `wrapper`（`system-reminder` / `none`）でタグの有無が変わる |
| 設定ファイルの変更が次のセッション開始で反映される | `session_start`（`/reload` を含む）で読み込まれる |
| 設定ファイルが壊れていてもセッションが止まらない | 壊れた JSON でも警告のみで起動する |

### 最小の成立条件

次の機能がそろえば上の達成状態を満たします。

| 成立条件 | 達成する状態 |
|---|---|
| 行単位スキャナによる `@path` の抽出と展開 | import 先の本文がプロンプトに入る |
| Claude Code 形式の固定文・説明文 | メモリ本文が Claude Code 2.1.287 と一致する |
| `wrapper` による包み方の切替 | 本文を包む形式を設定ファイルで選べる |
| 1つ以上解決したときだけの `project_context` の置き換え | import が1つ以上解決したときだけ置き換わる |
| グローバルとプロジェクトの設定ファイルの読み込みと検証 | 設定ファイルの変更が次のセッション開始で反映される。設定ファイルが壊れていてもセッションが止まらない |

### 非目標

Claude Code または Pi の一般機能と重複するため、次は実装しません。提案時はここを先に確認します。

- 外部 import の承認ダイアログ。Pi は全モード共通の承認 UX を持たず、無いまま読み込みます。
- frontmatter `paths:` による条件付きルール。Pi に対応する概念がありません。
- auto memory / team memory / `MEMORY.md` の切り詰め。Pi に存在しません。
- status line とコマンド。注入専用であり、モデル向けのツールも登録しません。
- `claudeMdExcludes` 相当の除外設定。Pi 側の context file 探索を変更しないためです。

### 拡張の条件

最小の成立条件を超える機能は、最小構成には含めません。現在の設計に含まれるものも今後の追加も、達成状態への寄与を実測で示せるときだけ維持・追加します。実測で寄与が示せない機能は削除の候補とします。

## 仕様の位置づけ

Claude Code 2.1.287 の挙動が外部仕様の基準です。リポジトリ内の実装契約と変更判断の正はテストであり、実装とテストが食い違う場合はテストが正です。Claude Code の挙動に追随する場合は、先にテストと本ドキュメントを更新します。

## 固有の原則

- `project_context` セクションを置き換える。親ファイルを含めて Claude Code と同じ並びにするためであり、Pi 既定の `<project_instructions>` タグ付き形式と二重にしないためです。
- import が1つも解決しないときは何もしない。import を使わないプロジェクトのプロンプトを変えないためです。
- wrapper は `system-reminder` を既定にする。Claude Code 2.1.287 がこの形式で包むためです。`none` は Pi のシステムプロンプト内で素の本文を好む場合の選択肢です。
- パーサは自作する。公式に保証された除外はコードスパンとフェンスコードブロックであり、Markdown パーサー（marked）のトークン単位の一致までは必要ないためです。実行時依存ゼロを保つほうがテストも配布も単純になります。
- 種別（`user` / `project`）は context file の場所で決め、import は親の種別を継承する。Claude Code 内部の `processMemoryFile` が再帰のたびに種別を渡すのと同じです。

## スキャナの限定

Claude Code は Markdown パーサー（marked）のトークン単位で抽出します。pi-import は行単位の規則で近似しているため、次の限定があります。いずれもテストで固定しています。

| 限定 | 理由 |
|---|---|
| 強調記法の直後の `@`（`**@a.md**`）は展開しない | 直前が空白でないため。Claude Code は text トークン先頭として展開する |
| インデントコードブロック（4スペース）は除外しない | 公式ドキュメントの保証はコードスパンとフェンスコードブロックのみ |
| 複数行にまたがるインラインコードスパンは除外しない | 行単位スキャナの割り切り。フェンスコードブロックは除外する |
| 行頭から始まる、閉じられていない `<!--` は注入本文ではそのまま残し、スキャンはそこで止める | Claude Code は未閉じ HTML ブロック以降をスキャンせず、注入本文には残す |
| 閉じられていない frontmatter（`---` が閉じない）は本文として扱う | Claude Code の `FRONTMATTER_REGEX` と同じ |

## Pi 拡張としての前提

- `before_agent_start` で `systemPromptOptions.sections["project_context"]` を書き換えると、Pi はセクションの差分を transcript に記録します。compaction 後もこのセクションは維持されます。
- context file はセッション開始時に読み込まれます。セッション中のファイル編集は `/reload` まで反映されません。Pi の既存挙動と同じです。
- Pi がセクションを `<project_context>...</project_context>` で包むため、プロンプト上の外側のタグは Claude Code と異なります。内側のメモリ本文は一致します。

## 仕様の根拠

| 対象 | 確認方法 |
|---|---|
| 抽出正規表現・有効パス判定・深さ・サイズ上限・拡張子リスト | Claude Code 2.1.287 のローカルバイナリに埋め込まれた JavaScript |
| メモリ本文の固定文・種別ごとの説明文・区切り・改行 | 同じ JavaScript と、`ANTHROPIC_BASE_URL` をローカル HTTP サーバーに向けて捕獲した `/v1/messages` リクエスト |
| コードスパン・フェンス・コメント・frontmatter・引用符・空白エスケープ・末尾記号 | 捕獲したリクエストと [test/unit/scan.test.ts](test/unit/scan.test.ts) |
| 順序・重複・循環・ネスト相対・外部 import | 捕獲したリクエストと [test/unit/expand.test.ts](test/unit/expand.test.ts) |

捕獲は Claude Code 2.1.287（Linux、`~/.local/share/claude/versions/2.1.287`）を対象に、`ANTHROPIC_BASE_URL` をローカルの HTTP サーバーへ向けて `/v1/messages` のリクエストボディを保存して行いました。埋め込まれた JavaScript は同じバイナリから直接確認できます。
