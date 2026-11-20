// メンバー情報は data/members.json から読み込む。
// このファイルは GitHub Actions が公式サイトから毎日自動で更新する
// (scripts/update-members.mjs)。手作業での更新は不要。

let groups = {};      // { morning: [{name, color, code, image}, ...], ... }
let groupNames = {};  // { morning: "モーニング娘。'26", ... }
let colors = [];      // 回答ボタン [{name, code}, ...]
let groupColors = {}; // { morning: {primary, secondary}, ... }
let themeColor = "#0080cb";   // ハロー！プロジェクトの青 (ボタンなどに使う)
let themeLight = null;        // ハロプロの薄い青。公式サイトに定義がなければ青を白と混ぜて作る

// 回答ボタンの並び順。ここにない新しい色は色相順で最後に追加される。
const COLOR_ORDER = [
    "ライトピンク", "ピーチ", "ピンク", "ホットピンク",
    "ライトレッド", "ピュアレッド", "レッド", "イタリアンレッド",
    "オレンジ", "イエロー", "デイジー", "マスタード",
    "ライトグリーン", "グリーン", "ブライトグリーン", "ミントグリーン", "エメラルドグリーン",
    "ライトブルー", "シーブルー", "ブルー", "ミディアムブルー", "ロイヤルブルー",
    "ライトパープル", "ラベンダー", "パープル",
    "ミルクティー", "ホワイト",
];

// 白文字にする色。ここにない新しい色は明るさから自動で判定する。
const DARK_COLORS = [
    "パープル", "ロイヤルブルー", "ブルー", "ミディアムブルー",
    "ピュアレッド", "ホットピンク", "ライトレッド", "レッド", "イタリアンレッド",
    "オレンジ", "ラベンダー", "エメラルドグリーン", "グリーン", "ブライトグリーン", "ミントグリーン",
];

function hexToRgb(code){
    const n = parseInt(code.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function hue(code){
    const [r, g, b] = hexToRgb(code).map(v => v / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    if(d === 0) return 999; // 白・グレーは最後
    let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return (h * 60 + 360) % 360;
}

// ホワイトなど、白背景だと見えにくい明るい色
function isVeryLight(code){
    const [r, g, b] = hexToRgb(code);
    return (0.299 * r + 0.587 * g + 0.114 * b) > 235;
}

function isDarkColor(color){
    if(DARK_COLORS.includes(color.name)) return true;
    const [r, g, b] = hexToRgb(color.code);
    return (0.299 * r + 0.587 * g + 0.114 * b) < 150;
}

// 全メンバーのカラーから回答ボタンを作る。
// 同じカラー名でメンバーごとにコードが違う場合は、一番多いコードをボタン色にする。
function buildColors(groupList){
    const counts = {};
    groupList.forEach(g => g.members.forEach(m => {
        if(!m.code || m.color === "わからない") return;
        counts[m.color] ??= {};
        counts[m.color][m.code] = (counts[m.color][m.code] ?? 0) + 1;
    }));

    return Object.entries(counts)
        .map(([name, codes]) => ({
            name,
            code: Object.entries(codes).sort((a, b) => b[1] - a[1])[0][0],
        }))
        .sort((a, b) => {
            const ia = COLOR_ORDER.indexOf(a.name), ib = COLOR_ORDER.indexOf(b.name);
            if(ia >= 0 && ib >= 0) return ia - ib;
            if(ia >= 0) return -1;
            if(ib >= 0) return 1;
            return hue(a.code) - hue(b.code);
        });
}

// グループ写真の周りに単色の余白がある場合 (公式サイトの画像によってはある)、
// 余白を切り取り、空いた部分は写真の背景色 (端の色の中央値) で埋める
function trimImagePadding(img){
    if(img.dataset.trimmed) return;
    img.dataset.trimmed = "1";

    const w = img.naturalWidth, h = img.naturalHeight;
    if(!w || !h) return;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", {willReadFrequently: true});
    ctx.drawImage(img, 0, 0);
    let data;
    try{ data = ctx.getImageData(0, 0, w, h).data; }catch{ return; }

    const px = (x, y) => { const i = (y * w + x) * 4; return [data[i], data[i + 1], data[i + 2]]; };
    const near = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) <= 24;
    const flatCol = (x, ref) => { for(let y = 0; y < h; y += 4){ if(!near(px(x, y), ref)) return false; } return true; };
    const flatRow = (y, ref) => { for(let x = 0; x < w; x += 4){ if(!near(px(x, y), ref)) return false; } return true; };

    let left = 0, right = w, top = 0, bottom = h;
    while(left < w / 3 && flatCol(left, px(0, 0))) left++;
    while(right > w * 2 / 3 && flatCol(right - 1, px(w - 1, 0))) right--;
    while(top < h / 3 && flatRow(top, px(0, 0))) top++;
    while(bottom > h * 2 / 3 && flatRow(bottom - 1, px(0, h - 1))) bottom--;

    // 余白がほぼない画像はそのまま
    if((left + (w - right)) < w * 0.01 && (top + (h - bottom)) < h * 0.01) return;

    // 写真と余白の境目には中間色の線が残りやすいので、余白があった辺は少し内側まで切る
    const shave = Math.ceil(Math.max(w, h) * 0.004);
    if(left > 0) left += shave;
    if(right < w) right -= shave;
    if(top > 0) top += shave;
    if(bottom < h) bottom -= shave;

    // 写真の内側の端から背景色を拾う (左右で色が違うことがあるので別々に)
    const inset = 2;
    const median = samples => {
        const ch = i => samples.map(p => p[i]).sort((a, b) => a - b)[samples.length >> 1];
        return `rgb(${ch(0)}, ${ch(1)}, ${ch(2)})`;
    };
    const edgeColor = x => {
        const samples = [];
        for(let y = top + inset; y < bottom - inset; y += 2) samples.push(px(x, y));
        return median(samples);
    };
    const leftColor = edgeColor(left + inset);
    const rightColor = edgeColor(right - 1 - inset);
    const bg = `linear-gradient(to right, ${leftColor} 50%, ${rightColor} 50%)`;

    const out = document.createElement("canvas");
    out.width = right - left;
    out.height = bottom - top;
    out.getContext("2d").drawImage(img, left, top, out.width, out.height, 0, 0, out.width, out.height);
    img.style.background = bg;
    img.src = out.toDataURL("image/webp", 0.92);
}

// ページの背景をグループカラー (薄い色) にし、ボタンの色もそのグループカラーにする。
// null ならホーム画面用 (全グループの薄い色のグラデーション)
function lightColor(primary, secondary){
    return secondary || `color-mix(in srgb, ${primary} 18%, white)`;
}

function setPageColor(group){
    const colors = group && groupColors[group];
    const primary = colors?.primary || themeColor;
    const body = document.body;
    body.style.backgroundColor = colors
        ? lightColor(colors.primary, colors.secondary)
        : lightColor(themeColor, themeLight);
    // ホーム画面ではグラデーションの層を表示し、グループ選択中はフェードアウトして単色を見せる
    body.classList.toggle("home-bg", !colors);
    body.style.setProperty("--theme", primary);
    body.style.setProperty("--theme-on", isDarkColor({name: "", code: primary}) ? "white" : "black");
}

function renderGroupCards(groupList){
    const carousel = document.getElementById("groupCarousel");
    carousel.innerHTML = "";

    groupList.forEach(g => {
        const card = document.createElement("div");
        card.className = "group-card";
        card.onclick = () => selectGroup(g.id);

        if(g.colors?.primary){
            card.style.setProperty("--group-color", g.colors.primary);
        }

        // PC でカードにマウスを乗せると、背景がそのグループカラーになる
        card.addEventListener("pointerenter", e => {
            if(e.pointerType === "mouse") setPageColor(g.id);
        });
        card.addEventListener("pointerleave", e => {
            if(e.pointerType === "mouse" && !selectedGroup) setPageColor(null);
        });

        if(g.image){
            const img = document.createElement("img");
            img.alt = g.name;
            img.addEventListener("load", () => trimImagePadding(img));
            img.src = g.image;
            card.appendChild(img);
        }

        const title = document.createElement("h2");
        title.textContent = g.name;
        card.appendChild(title);

        carousel.appendChild(card);
    });
}

async function loadData(){
    try{
        const res = await fetch("data/members.json", {cache: "no-cache"});
        if(!res.ok) throw new Error(res.status);
        const data = await res.json();

        themeColor = data.theme?.primary || themeColor;
        themeLight = data.theme?.secondary || null;
        setPageColor(null);

        data.groups.forEach(g => {
            groups[g.id] = g.members;
            groupNames[g.id] = g.name;
            groupColors[g.id] = g.colors;
        });

        // ホーム画面の背景: 全グループの薄い色を並べたグラデーション
        const stops = data.groups
            .filter(g => g.colors?.primary)
            .map(g => lightColor(g.colors.primary, g.colors.secondary));
        if(stops.length >= 2){
            document.body.style.setProperty("--home-gradient", `linear-gradient(120deg, ${stops.join(", ")})`);
        }
        colors = buildColors(data.groups);
        renderGroupCards(data.groups);
    }catch(e){
        console.error(e);
        document.getElementById("groupCarousel").textContent =
            "メンバー情報を読み込めませんでした。時間をおいて再読み込みしてください。";
    }
}

loadData();

function shuffle(array){
    for(let i = array.length - 1; i > 0; i--){
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// アー写を先に読み込んでおき、切り替え時に表示が遅れないようにする
const preloadedImages = new Map();
function preloadImages(urls){
    urls.forEach(url => {
        if(!url || preloadedImages.has(url)) return;
        const img = new Image();
        img.decoding = "async";
        img.src = url;
        preloadedImages.set(url, img);
    });
}

let selectedGroup;
let questions = [];
let currentIndex = 0;
let score = 0;
let mistakes = [];

function showScreen(id){

    document.querySelectorAll(".screen")
        .forEach(e=>e.classList.add("hidden"));

    document.getElementById(id)
        .classList.remove("hidden");
}

function selectGroup(group){

    selectedGroup = group;
    setPageColor(group);

    let count =
        groups[group].length;

    document.getElementById("groupTitle")
    .textContent = groupNames[group];

    document.getElementById("questionCount")
        .textContent =
        `全${count}問`;

    preloadImages(groups[group].map(m => m.image));

    showScreen("startScreen");
    startCarousel();
}

function startQuiz(){
    clearInterval(carouselTimer);
    questions =
        shuffle([...groups[selectedGroup]]);

    currentIndex = 0;
    score = 0;
    mistakes = [];

    canAnswer = true;

    document.getElementById("skipBtn").disabled = false;
    document.getElementById("homeBtn").disabled = false;
    createColorButtons();

    showScreen("quizScreen");

    showQuestion();
}

// この時間以上押し続けたらボタンを沈める (ミリ秒)
const HOLD_MS = 120;

function createColorButtons(){

    const grid =
        document.getElementById("colorGrid");

    grid.innerHTML = "";

    colors.forEach(color=>{

        const btn =
            document.createElement("button");

        btn.className = "color-btn";

        btn.textContent = color.name;

        btn.style.backgroundColor =
            color.code;
        btn.style.setProperty("--c", color.code);
        btn.dataset.color = color.name;

        if(isDarkColor(color)){
            btn.style.color = "white";
        }else{
            btn.style.color = "black";
        }

        if(isVeryLight(color.code)){
            btn.classList.add("light-color");
        }

        // 長押ししたときだけ沈める (短いクリックは沈まずにそのまま正解・不正解の表示へ)
        let holdTimer = null;
        btn.addEventListener("pointerdown", () => {
            clearTimeout(holdTimer);
            holdTimer = setTimeout(() => btn.classList.add("is-holding"), HOLD_MS);
        });
        btn.addEventListener("pointerup", () => {
            clearTimeout(holdTimer);
            // click の処理 (markAnswer) が沈んでいたかを見てから戻す
            setTimeout(() => btn.classList.remove("is-holding"), 0);
        });
        ["pointerleave", "pointercancel"].forEach(type =>
            btn.addEventListener(type, () => {
                clearTimeout(holdTimer);
                btn.classList.remove("is-holding");
            })
        );

        btn.onclick = () =>
            answer(color.name);

        grid.appendChild(btn);

    });

}

function showQuestion(){

    const q =
        questions[currentIndex];

    document.getElementById("progress")
        .textContent =
        `${currentIndex+1}/${questions.length}`;

    document.getElementById("memberName")
        .textContent =
        q.name;

    document.getElementById("memberImage")
        .src =
        q.image;
}

let canAnswer = true;

// 回答後: 正解のボタンを光らせ、間違えたボタンを揺らす
function markAnswer(selected, correct){
    document.querySelectorAll(".color-btn").forEach(btn => {
        if(btn.dataset.color === correct){
            btn.classList.add("is-correct");
        }else if(btn.dataset.color === selected){
            btn.classList.add("is-wrong");
        }
        if(btn.dataset.color === selected){
            // 長押しで沈んでいたら沈んだ位置から、短いクリックならその場からアニメーションする
            btn.classList.add(btn.classList.contains("is-holding") ? "is-pressed" : "is-tapped");
            btn.classList.remove("is-holding");
        }
    });
}

function answer(selected){
    if(!canAnswer) return;

    canAnswer = false;

    const q =
        questions[currentIndex];

    const correct =
        q.color;

    if(selected===correct){

        score++;

        showOverlay(
            `⭕ 正解<br>${correct}`,
            q.code
        );
        markAnswer(selected, correct);

    }else{

        mistakes.push({
            name:q.name,
            answer:selected,
            correct:correct
        });

        showOverlay(
            `❌ 不正解<br>正解：${correct}`,
            q.code
        );
        markAnswer(selected, correct);
    }

    setTimeout(nextQuestion,1000);
}

function skipQuestion(){
    if(!canAnswer) return;

    canAnswer = false;

    const q = questions[currentIndex];

    if(q.color === "わからない"){

        score++;

        showOverlay(
            "⭕ 正解<br>メンバーカラー未発表",
            null
        );

    }else{

        mistakes.push({
            name:q.name,
            answer:"未回答",
            correct:q.color
        });

        showOverlay(
            `正解：${q.color}`,
            q.code
        );
        markAnswer(null, q.color);
    }

    setTimeout(nextQuestion,1000);
}

function nextQuestion(){

    document.getElementById("overlay")
    .className = "hidden";

    currentIndex++;

    if(currentIndex>=questions.length){

        showResult();

        return;
    }
    canAnswer = true;
    showQuestion();

    document
        .querySelectorAll(".color-btn")
        .forEach(btn=>{

            btn.disabled = false;
            btn.classList.remove("is-correct", "is-wrong", "is-pressed", "is-tapped", "is-holding");

        });

    document
        .getElementById("skipBtn")
        .disabled = false;
    document
        .getElementById("homeBtn")
        .disabled = false;
}

// code: そのメンバーのカラーコード (未発表なら null → 黒枠)
function showOverlay(text,code){

    const overlay =
        document.getElementById("overlay");

    overlay.innerHTML = text;

    overlay.className = "show";

    overlay.style.border =
        `6px solid ${code || "black"}`;

    // ホワイトなどは白背景に溶けるので、枠の内側と外側にグレーの線を付ける
    if(code && isVeryLight(code)){
        overlay.classList.add("light-border");
    }

    document
        .querySelectorAll(".color-btn")
        .forEach(btn=>{

            btn.disabled = true;

        });

    document
        .getElementById("skipBtn")
        .disabled = true;
    document
        .getElementById("homeBtn")
        .disabled = true;
}

function showResult(){

    showScreen("resultScreen");

    document.getElementById("scoreText")
        .innerHTML =
        `
        ${questions.length}問中
        ${score}問正解
        <br>
        正答率
        ${(score/questions.length*100)
        .toFixed(1)}%
        `;

    const area =
        document.getElementById("mistakes");

    area.innerHTML = "";

    mistakes.forEach(m=>{

        area.innerHTML +=
        `
        <p>
        ❌ ${m.name}<br>
        回答:${m.answer}<br>
        正解:${m.correct}
        </p>
        `;
    });
}

function goHome(){

    clearInterval(carouselTimer);
    selectedGroup = null;
    setPageColor(null);
    showScreen("homeScreen");
}

let carouselIndex = 0;
let carouselTimer = null;

function updateCarousel(){

    const img =
        document.getElementById(
            "carouselImage"
        );

    img.style.opacity = 0;

    setTimeout(()=>{

        // ホームに戻った後なら何もしない
        if(!selectedGroup) return;

        const members =
            groups[selectedGroup];

        img.src =
            members[carouselIndex].image;

        document
            .getElementById(
                "carouselName"
            )
            .textContent =
            members[carouselIndex].name;

        img.style.opacity = 1;

    },200);
}

function startCarousel(){

    const members =
        groups[selectedGroup];

    carouselIndex = 0;

    updateCarousel();

    clearInterval(carouselTimer);

    carouselTimer = setInterval(()=>{

        carouselIndex++;

        if(
            carouselIndex >=
            members.length
        ){
            carouselIndex = 0;
        }

        updateCarousel();

    },2000);

}
