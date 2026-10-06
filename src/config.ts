// サイトの設定はすべてここに集約する。
// 自己紹介文とアバターは Nostr のプロフィール (kind 0) から取得するので、ここには書かない。

export const config = {
  name: "RikiyaOta",
  npub: "npub1vg07ayjj6xmvya8vdzss4gw0zdge6a95gk038h4xpfw066x9vxqsp22ygn",
  links: [{ label: "GitHub", url: "https://github.com/RikiyaOta" }],
  // 投稿・プロフィールの取得元。Nostr アプリの書き込み先リレーと揃えること。
  relays: [
    "wss://yabu.me",
    "wss://relay-jp.nostr.wirednet.jp",
    "wss://relay.damus.io/",
    "wss://nos.lol/",
  ],
};
