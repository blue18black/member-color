// ハロー！プロジェクト公式サイトからメンバー情報を取得して
// data/members.json と images/auto/ を更新するスクリプト。
//
// 使い方: node scripts/update-members.mjs
// GitHub Actions (.github/workflows/update-members.yml) から毎日実行される。
// グループ構成・メンバー構成・メンバーカラー・アー写・グループ名・グループ写真をすべて自動で取得する。

import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = "https://helloproject.com";
const DATA_FILE = join(ROOT, "data", "members.json");
const IMAGE_DIR = join(ROOT, "images", "auto");
const USER_AGENT = "member-color-quiz-updater (+https://github.com/blue18black/member-color)";
const REQUEST_INTERVAL_MS = 500;

// グループは公式サイトのナビゲーション (Artist) から自動で検出する。
// 新グループが追加されれば自動でクイズに加わり、解散すれば消える。

// クイズの対象外にするグループ (公式サイトの URL の slug で判定)。
// 研修生 (helloprokenshusei, helloprokenshuseihokkaido など) と OG (卒業メンバー) を除外。
const EXCLUDE = [/kenshusei/, /^og$/];
const isExcluded = (slug) => EXCLUDE.some((re) => re.test(slug));

// 既存グループのサイト内キー (画像ファイル名などに使う)。ここにない新グループは slug がそのままキーになる。
const KNOWN_IDS = {
    morningmusume: "morning",
    angerme: "ange",
    juicejuice: "juice",
    tsubakifactory: "tsubaki",
    beyooooonds: "beyo",
    ochanorma: "ocha",
    rosychronicle: "rosy",
};

// トップページから、グループ一覧・グループ写真・グループカラーを取得する
async function discoverGroups() {
    const html = await fetchWithRetry(`${BASE}/`);
    const slugs = [];
    for (const m of html.matchAll(/<a href="\/([a-z0-9_-]+)\/"[^>]*class="[^"]*NavigationLink--group[^"]*"/g)) {
        if (!slugs.includes(m[1])) slugs.push(m[1]);
    }
    if (slugs.length === 0) {
        throw new Error("トップページからグループ一覧を取得できませんでした (サイトの構造が変わった可能性)");
    }
    const excluded = slugs.filter(isExcluded);
    if (excluded.length) console.log(`対象外: ${excluded.join(", ")}`);

    // トップページの「Artist」欄のグループ写真 (1500x1000)。なければグループページの og:image を使う
    const images = {};
    const artists = html.slice(html.indexOf("commonGrid--artists"));
    for (const m of artists.matchAll(/<a [^>]*href="\/([a-z0-9_-]+)\/"[^>]*>\s*<div class="Thumbnail[^"]*"><img src="([^"]+)"/g)) {
        images[m[1]] ??= m[2];
    }

    // サイトの CSS に定義されているグループカラー (--color-<slug>-primary / -secondary)
    let css = "";
    for (const m of html.matchAll(/<link rel="stylesheet" href="(\/[^"]+\.css)"/g)) {
        css += await fetchWithRetry(new URL(m[1], BASE).href);
    }
    const cssColor = (slug, kind) =>
        css.match(new RegExp(`--color-${slug}-${kind}:\\s*(#[0-9a-fA-F]{3,6})`))?.[1].toLowerCase() ?? null;

    const groups = slugs.filter((s) => !isExcluded(s)).map((slug) => ({
        id: KNOWN_IDS[slug] ?? slug,
        slug,
        image: images[slug] ?? null,
        colors: { primary: cssColor(slug, "primary"), secondary: cssColor(slug, "secondary") },
    }));
    // ハロー！プロジェクト全体の色 (ホーム画面の背景に使う)
    const helloColor = { primary: cssColor("hello", "primary"), secondary: cssColor("hello", "secondary") };
    return { groups, helloColor };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchWithRetry(url, asBuffer = false) {
    for (let attempt = 1; ; attempt++) {
        try {
            await sleep(REQUEST_INTERVAL_MS);
            const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return asBuffer ? Buffer.from(await res.arrayBuffer()) : await res.text();
        } catch (e) {
            if (attempt >= 3) throw new Error(`${url}: ${e.message}`);
            await sleep(2000 * attempt);
        }
    }
}

function decodeEntities(s) {
    return s
        .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
        .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&");
}

const clean = (s) => decodeEntities(s.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();

// グループページ: グループ名・グループ写真(予備)・メンバー一覧(順番・正方形アー写)
function parseGroupPage(html, slug) {
    const title = html.match(/<title>([^<]*)<\/title>/)?.[1];
    const name = title ? decodeEntities(title).split(" - ")[0].trim() : null;
    const groupImage = html.match(/property="og:image"\s+content="([^"]+)"/)?.[1]
        ?? html.match(/og:image"\s+content="([^"]+)"/)?.[1];

    const members = [];
    const re = new RegExp(
        `<div class="MemberPanel"><a href="/${slug}/([a-z0-9_-]+)/"[\\s\\S]*?<img src="([^"]+)"`,
        "g",
    );
    for (const m of html.matchAll(re)) {
        if (!members.some((x) => x.id === m[1])) {
            members.push({ id: m[1], thumb: m[2] });
        }
    }
    return { name, groupImage, members };
}

// メンバーページ: 名前・メンバーカラー名・カラーコード
function parseMemberPage(html) {
    const name = html.match(/<h1 class="postTitle[^"]*"[^>]*>([\s\S]*?)<\/h1>/)?.[1];
    const colorTag = html.match(
        /<dd class="MemberHeader__color[^"]*"[^>]*style="background-color:\s*(#[0-9a-fA-F]{3,6})"[^>]*>([\s\S]*?)<\/dd>/,
    );
    return {
        name: name ? clean(name) : null,
        color: colorTag ? clean(colorTag[2]) : null,
        code: colorTag ? colorTag[1].toLowerCase() : null,
    };
}

// 公式サイトの画像 URL はファイル名がハッシュなので、変わったときだけ再ダウンロードする
function imageVersion(url) {
    return url.match(/([0-9a-f]{8})[0-9a-f]*\.\w+$/)?.[1] ?? "0";
}

async function saveImage(url, fileName, previousVersion, used) {
    const version = imageVersion(url);
    used.add(fileName);
    const path = join(IMAGE_DIR, fileName);
    let exists = true;
    try { await readFile(path); } catch { exists = false; }
    if (!exists || previousVersion !== version) {
        const buf = await fetchWithRetry(new URL(url, BASE).href, true);
        await writeFile(path, buf);
        console.log(`  画像を保存: ${fileName}`);
    }
    return `images/auto/${fileName}?v=${version}`;
}

async function main() {
    let previous = { groups: [] };
    try { previous = JSON.parse(await readFile(DATA_FILE, "utf8")); } catch { /* 初回 */ }
    const prevVersion = (path) => path?.match(/\?v=(\w+)/)?.[1];
    const prevGroups = Object.fromEntries(previous.groups.map((g) => [g.id, g]));

    await mkdir(IMAGE_DIR, { recursive: true });
    const used = new Set();
    const groups = [];

    const site = await discoverGroups();
    for (const g of site.groups) {
        console.log(`[${g.slug}]`);
        const html = await fetchWithRetry(`${BASE}/${g.slug}/`);
        const page = parseGroupPage(html, g.slug);
        if (!page.name || page.members.length === 0) {
            throw new Error(`${g.slug}: グループページを解析できませんでした (サイトの構造が変わった可能性)`);
        }

        const details = [];
        for (const m of page.members) {
            const detail = parseMemberPage(await fetchWithRetry(`${BASE}/${g.slug}/${m.id}/`));
            if (!detail.name) throw new Error(`${g.slug}/${m.id}: 名前を取得できませんでした`);
            details.push({ ...m, ...detail });
            console.log(`  ${detail.name} ${detail.color ?? "(カラー未発表)"} ${detail.code ?? ""}`);
        }

        // 結成直後などでメンバーカラーが1人も発表されていないグループは、発表されるまで出さない
        if (!details.some((d) => d.color)) {
            console.log(`  → メンバーカラー未発表のため ${page.name} はまだクイズに出しません`);
            continue;
        }

        const prev = prevGroups[g.id];
        const prevMembers = Object.fromEntries((prev?.members ?? []).map((m) => [m.id, m]));

        const groupImage = g.image ?? page.groupImage;
        const image = groupImage
            ? await saveImage(groupImage, `group_${g.id}.webp`, prevVersion(prev?.image), used)
            : prev?.image ?? null;

        const members = [];
        for (const d of details) {
            members.push({
                id: d.id,
                name: d.name,
                // メンバーカラー未発表の新メンバーは「わからない」が正解になる
                color: d.color ?? "わからない",
                code: d.code,
                image: await saveImage(d.thumb, `${g.id}_${d.id}.webp`, prevVersion(prevMembers[d.id]?.image), used),
            });
        }
        // グループカラーが取れなかった場合は前回の値を使う
        const colors = g.colors.primary ? g.colors : prev?.colors ?? g.colors;
        groups.push({ id: g.id, slug: g.slug, name: page.name, image, colors, members });
    }

    // 安全装置: 前回から極端にメンバーが減っていたら、サイト側の不具合とみなして更新しない
    const total = (gs) => gs.reduce((n, g) => n + g.members.length, 0);
    if (total(previous.groups) > 0 && total(groups) < total(previous.groups) * 0.6) {
        throw new Error(`メンバー数が ${total(previous.groups)} → ${total(groups)} に急減したため更新を中止しました`);
    }

    // 卒業などで使われなくなった画像を削除
    for (const file of await readdir(IMAGE_DIR)) {
        if (!used.has(file)) {
            await rm(join(IMAGE_DIR, file));
            console.log(`画像を削除: ${file}`);
        }
    }

    const theme = site.helloColor.primary ? site.helloColor : previous.theme ?? { primary: "#0080cb", secondary: null };
    const content = { theme, groups };
    const prevContent = JSON.stringify({ theme: previous.theme, groups: previous.groups });
    if (JSON.stringify(content) === prevContent) {
        console.log("変更なし");
        return;
    }
    const out = { updatedAt: new Date().toISOString(), ...content };
    await mkdir(dirname(DATA_FILE), { recursive: true });
    await writeFile(DATA_FILE, JSON.stringify(out, null, 2) + "\n");
    console.log(`data/members.json を更新しました (${total(groups)}人)`);
}

main().catch((e) => {
    console.error(e.message);
    process.exit(1);
});
