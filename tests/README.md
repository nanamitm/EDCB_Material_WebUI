共通APIの回帰テストです。EDCBサーバーへの接続や録画・設定の変更は行いません。
リポジトリのルートで実行してください。

```sh
node --test tests/common-api.test.cjs
node --test tests/data-sync-cache.test.cjs
node --test tests/reservation.test.cjs
node --test tests/autoadd.test.cjs
node --test tests/recinfo.test.cjs
node --test tests/epg-onair.test.cjs
node --test tests/search.test.cjs
node --test tests/library.test.cjs
node --test tests/streaming.test.cjs
node --test tests/player-datacast.test.cjs
lua tests/common-api.lua
lua tests/reservation.lua
lua tests/autoadd.lua
lua tests/recinfo.lua
lua tests/search.lua
lua tests/library.lua
lua tests/streaming.lua
lua tests/player-datacast.lua
```

JavaScript側はNode.js 22以降、Lua側はLua 5.2を想定しています。
フロントのHTML変換・通信失敗時の非再送と、LuaのJSON/XML変換を検証します。
同期・キャッシュのテストでは、応答順序、読み取り失敗、SSE通知とタイマーを制御し、
世代管理、再取得、EPGキャッシュの無効化、タブ切替、接続停止・復旧を検証します。
予約のテストでは、対象データの送信、プリセット置換、チューナー選択、詳細取得の競合、
長時間・日またぎ予約と削除失敗の応答を検証します。
自動予約のテストでは、プログラム予約フォーム、タイトルのテキスト表示、時刻・曜日の送信、
時間絞り込みの入力検証と、入力エラー時にEDCBへ更新を送らないことを確認します。
録画結果のテストでは、仮想ファイルを使って衝突拒否・移動失敗・履歴保存失敗・
安全なロールバックと保護の応答を確認し、詳細取得の競合・終了も検証します。
番組表・放送中一覧では、範囲別の局・サブチャンネル、空データ、サービスをまたぐEID、
放送時間未定と次番組への切り替え、ネットワーク選択を検証します。
検索では、通常・プリセットの応答競合、画面遷移、条件と結果の一括反映、過去番組の識別、
予約の結合、日数の境界とプリセット条件取得APIの互換性を検証します。
ビデオライブラリでは、一覧取得の応答競合・画面遷移・再生パラメータ、親階層の消失、
TSパスの引用、チャプターのサイズ上限・読み込み失敗、自動サムネイル保存先の作成を検証します。
外部コマンドとファイル操作はモック化し、実行しません。
視聴配信では、動画情報・HLS開始待ちの競合、TS-Live初期化中の切替・破棄、
HLS禁止設定、非HLS配信の画質・音声・シーク・倍速パラメータを検証します。
仮想ファイルによるRange配信（通常・HEAD・部分・末尾・範囲外・切断）と、
NetworkTV開始失敗時に新しいセッションを停止しないことも確認します。
プレイヤー・字幕・データ放送・実況では、字幕表示設定の維持、チャプター操作のイベント解除、
補助ストリーム・ログ・PSC取得の競合と終了、再接続の上限、実況開始日時、
メタデータ確定後の再生時間送信、過去ログ取得・インポートの失敗応答を検証します。
