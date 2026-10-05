# 設計思想 — pi-import

読者は pi-import を変更する開発者と AI エージェントです。共通の哲学は [PHILOSOPHY.md](PHILOSOPHY.md)、
検証可能な制約と変更手順は [AGENTS.md](AGENTS.md) にあります。

## 何を解くか

Pi は context file（`AGENTS.md` / `CLAUDE.md` など）を読み込んで `project_context` セクションに注入しますが、
Claude Code の `@path` ファイル注入は持ちません。pi-import は `@path` を展開し、
Claude Code 2.1.287 と同一のメモリ本文を再現します。

## 固有の原則

- 仕様の正は Claude Code 2.1.287。バンドルされた JavaScript、公式ドキュメント、
  ローカルモックサーバーで捕獲した実 API リクエストの3つで照合した。golden 値はここに由来する。
- `project_context` セクションを置き換える。親ファイルを含めて Claude Code と同じ並びにするためであり、
  Pi 既定の `<project_instructions>` 形式と二重にしないためです。
- import が1つも解決しないときは何もしない。import を使わないプロジェクトのプロンプトを変えないためです。
- wrapper は `system-reminder` を既定にする。Claude Code 2.1.287 がこの形式で包むためです。
  `none` は Pi のシステムプロンプト内で素の本文を好む場合の選択肢です。
- パーサは自作する。公式に保証された除外はコードスパンとフェンスコードブロックであり、
  marked のトークン単位の一致までは必要ない。実行時依存ゼロを保つほうがテストも配布も単純になる。
- 種別（`user` / `project`）は context file の場所で決め、import は親の種別を継承する。
  Claude Code が `processMemoryFile` の再帰で種別を引き継ぐのと同じです。

## 意図的にやらないこと

固有の原則の具体例です。提案時に最初に確認します。

- 外部 import の承認ダイアログ。Pi は全モード共通の承認 UX を持たず、無いまま読み込みます。
- frontmatter `paths:` による条件付きルール。Pi に対応する概念がありません。
- auto memory / team memory / `MEMORY.md` の切り詰め。Pi に存在しません。
- status line とコマンド。注入専用であり、モデル向けのツールも登録しません。
- `claudeMdExcludes` 相当の除外設定。Pi 側の context file 探索を変更しないためです。

## スキャナの限定

marked のトークン単位の再現ではなく、行単位の規則で近似しています。テストで固定した限定は次のとおりです。

| 限定 | 理由 |
|---|---|
| 強調記法の直後の `@`（`**@a.md**`）は展開しない | 直前が空白でないため。Claude Code は text トークン先頭として展開する |
| インデントコードブロック（4スペース）は除外しない | 公式ドキュメントの保証はコードスパンとフェンスコードブロックのみ |
| 複数行にまたがるインラインコードスパンは除外しない | 行単位スキャナの割り切り。フェンスコードブロックは除外する |
| 閉じられていない `<!--` の残りはそのまま残す | 誤記が以降の本文を飲み込まないため。Claude Code と同じ意図 |

## Pi 拡張としての前提

- `before_agent_start` で `systemPromptOptions.sections["project_context"]` を書き換えると、
  Pi はセクションの差分を transcript に記録します。compaction 後もこのセクションは維持されます。
- context file はセッション開始時に読み込まれます。セッション中のファイル編集は `/reload` まで反映されません。
  Pi の既存挙動と同じです。
- Pi がセクションを `<project_context>...</project_context>` で包むため、プロンプト上の外側のタグは
  Claude Code と異なります。内側のメモリ本文は一致します。

## 仕様の根拠

| 対象 | 確認方法 |
|---|---|
| 抽出正規表現・有効パス判定・深さ・サイズ上限・拡張子リスト | インストール済みバイナリのバンドル JS |
| メモリ本文の固定文・種別ごとの説明文・区切り・改行 | バイナリの整形コードと実 API リクエストの捕獲 |
| コードスパン・フェンス・コメント・frontmatter・引用符・空白エスケープ・末尾記号 | 実 API リクエストの捕獲と `test/unit/scan.test.ts` |
| 順序・重複・循環・ネスト相対・外部 import | 実 API リクエストの捕獲と `test/unit/expand.test.ts` |
