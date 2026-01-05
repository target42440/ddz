const statusEl = document.getElementById("status");
const readyButton = document.getElementById("ready");
const renameButton = document.getElementById("rename");
const nicknameInput = document.getElementById("nickname");
const roomKeyInput = document.getElementById("room-key");
const joinButton = document.getElementById("join");
const handEl = document.getElementById("hand");
const playButton = document.getElementById("play");
const passButton = document.getElementById("pass");
const turnEl = document.getElementById("turn");
const multiplierEl = document.getElementById("multiplier");
const lastPlayEl = document.getElementById("last-play");
const toastEl = document.getElementById("toast");

const state = {
  playerId: null,
  players: [],
  hand: [],
  turn: null,
  lastPlay: null,
  multiplier: 1,
  joined: false,
};

const socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`);

const showToast = (message, timeout = 2000) => {
  toastEl.textContent = message;
  toastEl.classList.add("show");
  setTimeout(() => toastEl.classList.remove("show"), timeout);
};

const updatePlayers = () => {
  for (let index = 0; index < 3; index += 1) {
    const slot = state.players[index];
    const nameEl = document.getElementById(`name-${index}`);
    const readyEl = document.getElementById(`ready-${index}`);
    const cardsEl = document.getElementById(`cards-${index}`);
    if (!slot) {
      nameEl.textContent = "等待玩家";
      readyEl.textContent = "未准备";
      readyEl.classList.remove("ready");
      cardsEl.textContent = "";
      continue;
    }
    nameEl.textContent = slot.name + (slot.id === state.playerId ? " (你)" : "");
    readyEl.textContent = slot.ready ? "已准备" : "未准备";
    readyEl.classList.toggle("ready", slot.ready);
    cardsEl.textContent = `剩余 ${slot.cardCount} 张`;
  }
};

const updateHand = () => {
  handEl.innerHTML = "";
  state.hand.forEach((card) => {
    const cardEl = document.createElement("div");
    cardEl.className = "card";
    cardEl.textContent = `${card.rank}${card.suit}`;
    cardEl.dataset.id = card.id;
    cardEl.addEventListener("click", () => {
      cardEl.classList.toggle("selected");
    });
    handEl.appendChild(cardEl);
  });
};

const updateTurn = () => {
  if (!state.turn) {
    turnEl.textContent = "等待开始";
    return;
  }
  turnEl.textContent = state.turn === state.playerId ? "轮到你出牌" : "等待对手";
};

const updateLastPlay = () => {
  if (!state.lastPlay) {
    lastPlayEl.textContent = "上一手：暂无";
    return;
  }
  const cards = state.lastPlay.cards.map((card) => `${card.rank}${card.suit}`).join(" ");
  lastPlayEl.textContent = `上一手：${state.lastPlay.type} · ${cards}`;
};

const getSelected = () => {
  return Array.from(document.querySelectorAll(".card.selected")).map((el) => el.dataset.id);
};

socket.addEventListener("open", () => {
  statusEl.textContent = "请输入密钥加入";
});

socket.addEventListener("message", (event) => {
  const data = JSON.parse(event.data);
  if (data.type === "welcome") {
    state.playerId = data.playerId;
    nicknameInput.value = data.name;
    state.joined = true;
    statusEl.textContent = "已加入房间";
  }
  if (data.type === "state") {
    state.players = data.payload.players;
    state.turn = data.payload.turn;
    state.lastPlay = data.payload.lastPlay;
    state.multiplier = data.payload.multiplier;
    multiplierEl.textContent = state.multiplier;
    updatePlayers();
    updateTurn();
    updateLastPlay();
  }
  if (data.type === "hand") {
    state.hand = data.payload;
    updateHand();
  }
  if (data.type === "error") {
    showToast(data.message);
  }
  if (data.type === "need-join") {
    statusEl.textContent = data.message;
  }
  if (data.type === "win") {
    showToast(`${data.payload.name} 获胜！倍数 ${data.payload.multiplier}x`, 4000);
  }
});

socket.addEventListener("close", () => {
  statusEl.textContent = "已断开";
});

joinButton.addEventListener("click", () => {
  if (state.joined) {
    showToast("已加入房间");
    return;
  }
  socket.send(
    JSON.stringify({
      type: "join",
      key: roomKeyInput.value.trim(),
      name: nicknameInput.value || "玩家",
    }),
  );
});

renameButton.addEventListener("click", () => {
  if (!state.joined) {
    showToast("请先加入房间");
    return;
  }
  socket.send(
    JSON.stringify({
      type: "rename",
      name: nicknameInput.value || "玩家",
    }),
  );
});

readyButton.addEventListener("click", () => {
  if (!state.joined) {
    showToast("请先加入房间");
    return;
  }
  socket.send(JSON.stringify({ type: "ready" }));
});

playButton.addEventListener("click", () => {
  if (!state.joined) {
    showToast("请先加入房间");
    return;
  }
  const selected = getSelected();
  if (!selected.length) {
    showToast("请选择要出的牌");
    return;
  }
  socket.send(JSON.stringify({ type: "play", cards: selected }));
});

passButton.addEventListener("click", () => {
  if (!state.joined) {
    showToast("请先加入房间");
    return;
  }
  socket.send(JSON.stringify({ type: "pass" }));
});
