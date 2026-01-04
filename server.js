import express from "express";
import { WebSocketServer } from "ws";
import http from "http";

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;

app.use(express.static("public"));

const ROOM_ID = "main";
const ROOM_KEY = process.env.ROOM_KEY || "ddz-2025";
const rooms = new Map();

const RANKS = [
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "J",
  "Q",
  "K",
  "A",
  "2",
  "SJ",
  "BJ",
];
const RANK_VALUE = Object.fromEntries(RANKS.map((rank, index) => [rank, index]));

const SUITS = ["♠", "♥", "♣", "♦"];

const createDeck = () => {
  const deck = [];
  for (const rank of RANKS.slice(0, 13)) {
    for (const suit of SUITS) {
      deck.push({ rank, suit, id: `${rank}${suit}` });
    }
  }
  deck.push({ rank: "SJ", suit: "🃏", id: "SJ" });
  deck.push({ rank: "BJ", suit: "🃏", id: "BJ" });
  return deck;
};

const shuffle = (deck) => {
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
};

const getRoom = () => {
  if (!rooms.has(ROOM_ID)) {
    rooms.set(ROOM_ID, {
      players: new Map(),
      order: [],
      ready: new Set(),
      started: false,
      turn: null,
      lastPlay: null,
      multiplier: 1,
    });
  }
  return rooms.get(ROOM_ID);
};

const broadcast = (room, data) => {
  const message = JSON.stringify(data);
  for (const player of room.players.values()) {
    if (player.ws.readyState === 1) {
      player.ws.send(message);
    }
  }
};

const sendTo = (player, data) => {
  if (player.ws.readyState === 1) {
    player.ws.send(JSON.stringify(data));
  }
};

const sortHand = (hand) =>
  hand.sort((a, b) => RANK_VALUE[a.rank] - RANK_VALUE[b.rank]);

const deal = (room) => {
  const deck = shuffle(createDeck());
  const hands = [[], [], []];
  deck.forEach((card, index) => {
    if (index < 51) {
      hands[index % 3].push(card);
    }
  });
  room.order.forEach((playerId, index) => {
    const player = room.players.get(playerId);
    player.hand = sortHand(hands[index]);
  });
  room.started = true;
  room.turn = room.order[0];
  room.lastPlay = null;
  room.multiplier = 1;
};

const evaluatePlay = (cards) => {
  if (!cards.length) {
    return { valid: false, reason: "empty" };
  }
  const ranks = cards.map((card) => card.rank).sort((a, b) => RANK_VALUE[a] - RANK_VALUE[b]);
  const counts = ranks.reduce((acc, rank) => {
    acc[rank] = (acc[rank] || 0) + 1;
    return acc;
  }, {});
  const uniqueRanks = Object.keys(counts);

  if (ranks.length === 2 && ranks.includes("SJ") && ranks.includes("BJ")) {
    return { type: "rocket", value: Infinity, multiplier: 8, length: 2 };
  }

  if (uniqueRanks.length === 1) {
    const count = ranks.length;
    if (count >= 4) {
      return { type: "bomb", value: RANK_VALUE[uniqueRanks[0]], multiplier: 2, length: count };
    }
    return { type: "single", value: RANK_VALUE[uniqueRanks[0]], length: count };
  }

  if (uniqueRanks.length === ranks.length) {
    const sorted = uniqueRanks.sort((a, b) => RANK_VALUE[a] - RANK_VALUE[b]);
    const isStraight =
      sorted.every((rank, index) =>
        index === 0 || RANK_VALUE[rank] === RANK_VALUE[sorted[index - 1]] + 1,
      ) &&
      !sorted.includes("2") &&
      !sorted.includes("SJ") &&
      !sorted.includes("BJ") &&
      ranks.length >= 5;

    if (isStraight) {
      return { type: "straight", value: RANK_VALUE[sorted[sorted.length - 1]], length: ranks.length };
    }
  }

  const pairChain = uniqueRanks.length >= 2 &&
    uniqueRanks.every((rank) => counts[rank] === 2) &&
    uniqueRanks
      .slice()
      .sort((a, b) => RANK_VALUE[a] - RANK_VALUE[b])
      .every((rank, index, arr) =>
        index === 0 || RANK_VALUE[rank] === RANK_VALUE[arr[index - 1]] + 1,
      );

  if (pairChain) {
    const sorted = uniqueRanks.sort((a, b) => RANK_VALUE[a] - RANK_VALUE[b]);
    if (uniqueRanks.length === 2) {
      return { type: "chain-bomb", value: RANK_VALUE[sorted[1]], multiplier: 4, length: 4 };
    }
    if (uniqueRanks.length === 3) {
      return { type: "chain-bomb", value: RANK_VALUE[sorted[2]], multiplier: 6, length: 6 };
    }
    return { type: "pair-chain", value: RANK_VALUE[sorted[sorted.length - 1]], length: ranks.length };
  }

  const triple = uniqueRanks.length === 1 && ranks.length === 3;
  if (triple) {
    return { type: "triple", value: RANK_VALUE[uniqueRanks[0]], length: 3 };
  }

  return { valid: false, reason: "unsupported" };
};

const canBeat = (play, lastPlay) => {
  if (!lastPlay) {
    return true;
  }
  if (play.type === "rocket") {
    return true;
  }
  if (lastPlay.type === "rocket") {
    return false;
  }
  if (play.type === "bomb" || play.type === "chain-bomb") {
    if (lastPlay.type !== "bomb" && lastPlay.type !== "chain-bomb") {
      return true;
    }
    if (play.type === lastPlay.type) {
      return play.value > lastPlay.value && play.length >= lastPlay.length;
    }
    return play.type === "chain-bomb";
  }
  if (lastPlay.type === "bomb" || lastPlay.type === "chain-bomb") {
    return false;
  }
  return play.type === lastPlay.type && play.length === lastPlay.length && play.value > lastPlay.value;
};

const getStatePayload = (room) => {
  const players = room.order.map((playerId) => {
    const player = room.players.get(playerId);
    return {
      id: playerId,
      name: player.name,
      ready: room.ready.has(playerId),
      cardCount: player.hand.length,
    };
  });
  return {
    started: room.started,
    players,
    turn: room.turn,
    lastPlay: room.lastPlay,
    multiplier: room.multiplier,
  };
};

wss.on("connection", (ws) => {
  const room = getRoom();
  let joined = false;
  let playerId = null;
  let player = null;

  ws.send(JSON.stringify({ type: "need-join", message: "请输入密钥进入房间" }));

  ws.on("message", (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch (error) {
      return;
    }

    if (message.type === "join") {
      if (joined) {
        return;
      }
      if (message.key !== ROOM_KEY) {
        ws.send(JSON.stringify({ type: "error", message: "密钥错误" }));
        ws.close();
        return;
      }
      if (room.players.size >= 3) {
        ws.send(JSON.stringify({ type: "error", message: "房间已满" }));
        ws.close();
        return;
      }
      playerId = `p-${Math.random().toString(36).slice(2, 8)}`;
      player = {
        id: playerId,
        name: (message.name || `玩家${room.players.size + 1}`).slice(0, 8),
        ws,
        hand: [],
      };
      joined = true;
      room.players.set(playerId, player);
      room.order.push(playerId);
      sendTo(player, { type: "welcome", playerId, name: player.name });
      broadcast(room, { type: "state", payload: getStatePayload(room) });
      return;
    }

    if (!joined) {
      return;
    }

    if (message.type === "rename") {
      player.name = message.name.slice(0, 8);
      broadcast(room, { type: "state", payload: getStatePayload(room) });
      return;
    }

    if (message.type === "ready") {
      if (room.ready.has(playerId)) {
        room.ready.delete(playerId);
      } else {
        room.ready.add(playerId);
      }
      if (room.ready.size === 3 && room.players.size === 3) {
        deal(room);
        broadcast(room, { type: "deal", payload: { hands: null } });
      }
      broadcast(room, { type: "state", payload: getStatePayload(room) });
      if (room.started) {
        for (const target of room.players.values()) {
          sendTo(target, { type: "hand", payload: target.hand });
        }
      }
      return;
    }

    if (message.type === "play") {
      if (!room.started || room.turn !== playerId) {
        return;
      }
      const selected = message.cards || [];
      const cards = player.hand.filter((card) => selected.includes(card.id));
      if (cards.length !== selected.length) {
        return;
      }
      const result = evaluatePlay(cards);
      if (!result.type) {
        sendTo(player, { type: "error", message: "牌型不支持" });
        return;
      }
      if (!canBeat(result, room.lastPlay)) {
        sendTo(player, { type: "error", message: "没压住上一手" });
        return;
      }

      player.hand = player.hand.filter((card) => !selected.includes(card.id));
      room.lastPlay = { ...result, playerId, cards };
      if (result.multiplier) {
        room.multiplier *= result.multiplier;
      }
      const currentIndex = room.order.indexOf(playerId);
      room.turn = room.order[(currentIndex + 1) % room.order.length];
      broadcast(room, { type: "state", payload: getStatePayload(room) });
      for (const target of room.players.values()) {
        sendTo(target, { type: "hand", payload: target.hand });
      }

      if (player.hand.length === 0) {
        broadcast(room, {
          type: "win",
          payload: { playerId, name: player.name, multiplier: room.multiplier },
        });
        room.started = false;
        room.ready.clear();
        room.lastPlay = null;
      }
      return;
    }

    if (message.type === "pass") {
      if (!room.started || room.turn !== playerId) {
        return;
      }
      const currentIndex = room.order.indexOf(playerId);
      room.turn = room.order[(currentIndex + 1) % room.order.length];
      broadcast(room, { type: "state", payload: getStatePayload(room) });
      return;
    }
  });

  ws.on("close", () => {
    if (joined && playerId) {
      room.players.delete(playerId);
      room.order = room.order.filter((id) => id !== playerId);
      room.ready.delete(playerId);
      if (room.players.size === 0) {
        rooms.delete(ROOM_ID);
      } else {
        broadcast(room, { type: "state", payload: getStatePayload(room) });
      }
    }
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`ddz server running on http://0.0.0.0:${PORT}`);
});
