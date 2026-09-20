const http = require("http");
const WebSocket = require("ws");

const PORT = process.env.PORT || 10000;

const httpServer = http.createServer((req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/plain; charset=utf-8"
  });

  res.end("Rocket League.io server online");
});

const wss = new WebSocket.Server({
  server: httpServer
});

const waitingPlayers = [];
const matches = new Map();

let nextPlayerId = 1;
let nextMatchId = 1;

// ==============================
// NOTIFICATIONS
// ==============================

let serverNotifications = [];

function broadcastNotifications() {
  const payload = JSON.stringify({
    type: "notifications-sync",
    notifications: serverNotifications
  });

  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

// ==============================
// ENVOI DE DONNÉES
// ==============================

function send(player, data) {
  if (!player || !player.ws) return;

  if (player.ws.readyState === WebSocket.OPEN) {
    player.ws.send(JSON.stringify(data));
  }
}

// ==============================
// FILE D'ATTENTE
// ==============================

function removeFromQueue(player) {
  const index = waitingPlayers.indexOf(player);

  if (index !== -1) {
    waitingPlayers.splice(index, 1);
  }

  player.searching = false;
}

// ==============================
// CRÉATION D'UN MATCH
// ==============================

function makeMatch(player1, player2) {
  const matchId = "match-" + nextMatchId++;

  const match = {
    id: matchId,
    player1,
    player2
  };

  matches.set(matchId, match);

  player1.match = match;
  player2.match = match;

  player1.searching = false;
  player2.searching = false;

  send(player1, {
    type: "match-found",
    matchId,
    playerNumber: 1,
    team: "blue",
    isHost: true
  });

  send(player2, {
    type: "match-found",
    matchId,
    playerNumber: 2,
    team: "orange",
    isHost: false
  });

  console.log(
    `Match ${matchId}: ${player1.id} vs ${player2.id}`
  );
}

// ==============================
// RECHERCHE D'UN ADVERSAIRE
// ==============================

function findOpponent(player) {
  for (let i = 0; i < waitingPlayers.length; i++) {
    const opponent = waitingPlayers[i];

    if (
      opponent !== player &&
      opponent.searching &&
      !opponent.match
    ) {
      waitingPlayers.splice(i, 1);

      makeMatch(opponent, player);

      return true;
    }
  }

  return false;
}

// ==============================
// DÉCONNEXION D'UN MATCH
// ==============================

function disconnectMatch(player) {
  const match = player.match;

  if (!match) return;

  const opponent =
    match.player1 === player
      ? match.player2
      : match.player1;

  matches.delete(match.id);

  player.match = null;

  if (opponent) {
    opponent.match = null;

    send(opponent, {
      type: "opponent-left"
    });
  }
}

// ==============================
// CONNEXION D'UN JOUEUR
// ==============================

wss.on("connection", ws => {
  const player = {
    id: "player-" + nextPlayerId++,
    ws,
    searching: false,
    match: null
  };

  console.log("Player connected:", player.id);

  send(player, {
    type: "connected",
    playerId: player.id
  });

  // ==============================
  // MESSAGES DU JOUEUR
  // ==============================

  ws.on("message", raw => {
    let data;

    try {
      data = JSON.parse(raw.toString());
    } catch {
      return;
    }

    // ==============================
    // PING
    // ==============================

    if (data.type === "ping") {
      send(player, {
        type: "pong"
      });

      return;
    }

    // ==============================
    // RECHERCHE DE MATCH
    // ==============================

    if (data.type === "find-match") {
      if (player.match) return;

      removeFromQueue(player);

      player.searching = true;

      const found = findOpponent(player);

      if (!found) {
        waitingPlayers.push(player);

        send(player, {
          type: "searching"
        });

        console.log(
          `${player.id} is searching for a 1v1`
        );
      }

      return;
    }

    // ==============================
    // ANNULATION DE RECHERCHE
    // ==============================

    if (data.type === "cancel-search") {
      removeFromQueue(player);

      send(player, {
        type: "search-cancelled"
      });

      return;
    }

    // ==============================
    // INPUT DU JOUEUR
    // ==============================

    if (data.type === "input") {
      if (!player.match) return;

      const opponent =
        player.match.player1 === player
          ? player.match.player2
          : player.match.player1;

      send(opponent, {
        type: "opponent-input",
        input: data.input
      });

      return;
    }

    // ==============================
    // ÉTAT DU JEU
    // ==============================

    if (data.type === "game-state") {
      if (!player.match) return;

      // Seul l'hôte peut envoyer l'état officiel du jeu
      if (player.match.player1 !== player) return;

      const opponent = player.match.player2;

      send(opponent, {
        type: "game-state",
        state: data.state
      });

      return;
    }

    // ==============================
    // NOTIFICATIONS
    // ==============================

    if (data.type === "get-notifications") {
      send(player, {
        type: "notifications-sync",
        notifications: serverNotifications
      });

      return;
    }

    if (data.type === "admin-add-notification") {
      if (!data.notification) return;

      serverNotifications.unshift(data.notification);

      broadcastNotifications();

      return;
    }

    if (data.type === "admin-delete-notification") {
      serverNotifications = serverNotifications.filter(
        n => n.id !== data.id
      );

      broadcastNotifications();

      return;
    }

    // ==============================
    // STATISTIQUES ADMIN
    // ==============================

    if (data.type === "admin-stats") {
      send(player, {
        type: "admin-stats",
        matchCount: matches.size,
        waitingPlayers: waitingPlayers.length,
        connectedPlayers: wss.clients.size
      });

      return;
    }

    // ==============================
    // QUITTER LE MATCH
    // ==============================

    if (data.type === "leave-match") {
      disconnectMatch(player);

      return;
    }
  });

  // ==============================
  // FERMETURE DE LA CONNEXION
  // ==============================

  ws.on("close", () => {
    console.log("Player disconnected:", player.id);

    removeFromQueue(player);
    disconnectMatch(player);
  });

  ws.on("error", () => {
    removeFromQueue(player);
    disconnectMatch(player);
  });
});

// ==============================
// DÉMARRAGE DU SERVEUR
// ==============================

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(
    `Rocket League.io server listening on port ${PORT}`
  );
});
