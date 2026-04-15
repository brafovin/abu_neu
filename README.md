# ABU NEU — Build & Battle

Ein Fortnite-inspiriertes Browser-Spiel mit **Bauen, mehreren Waffen, Bot-KI
und verschiedenen Spielmodi**. Läuft komplett im Browser ohne Build-Step —
einfach `index.html` öffnen (oder einen lokalen HTTP-Server starten, siehe
unten, da ES-Module CORS-Restriktionen haben).

> **Wichtig:** Fortnite selbst ist geistiges Eigentum von Epic Games. Dieses
> Projekt ist eine eigene Fan-/Lern-Implementierung und verwendet keine
> Assets aus dem Originalspiel.

## Starten

Da das Spiel ES-Module nutzt, muss es über einen HTTP-Server geladen werden
(nicht per `file://`):

```bash
# Option A: Python
python3 -m http.server 8000

# Option B: Node
npx http-server -p 8000
```

Dann im Browser öffnen: <http://localhost:8000>

Three.js wird per CDN Import-Map geladen — keine npm-Installation nötig.

## Spielmodi

- **Solo Showdown** – Du gegen 9 Bots, letzter Überlebender gewinnt.
- **Wellen-Überleben** – Immer stärkere Bot-Wellen, wie lange hältst du durch?
- **Bau-Sandbox** – Unbegrenzte Ressourcen, freies Üben.
- **Team-Deathmatch** – Du + 2 Ally-Bots gegen 4 Feind-Bots, 20 Kills zum Sieg.

## Steuerung

| Taste | Aktion |
| --- | --- |
| `WASD` | Bewegen |
| `Maus` | Umsehen |
| `Leertaste` | Springen |
| `Shift` | Sprinten |
| `Linke Maus` | Schießen / Bauen |
| `1` – `4` | Pistole / Sturmgewehr / Schrotflinte / Sniper |
| `5` | Spitzhacke (Ressourcen farmen) |
| `Q` / `F` / `C` | Wand / Boden / Rampe auswählen |
| `G` | Bau-Modus an/aus |
| `R` | Nachladen |
| `ESC` | Pause |

## Features

- **Prozedurale 3D-Welt** mit Hügeln, Bäumen, Felsen und Häusern
- **Vier Waffen** mit unterschiedlichen Schadens-, Feuerraten- und Rückstoßwerten
- **Spitzhacke** zum Farmen von Holz (Bäume → Holz)
- **Bau-System** mit Raster-Snapping (Wand, Boden, Rampe)
- **Bot-KI** mit Zuständen: Patrouille → Verfolgung → Angriff
- **Headshot-Multiplikator**, Schild + Leben, Munitions-Management
- **Kill-Feed**, HUD mit Waffen- und Material-Anzeige

## Architektur

```
index.html          # Entry + HUD + Menus
css/style.css       # UI-Styling
js/main.js          # Mode-Switch & Menu-Events
js/game.js          # Game-Loop, Szene, Bullets, Kollisionen
js/world.js         # Terrain, Bäume, Felsen, Häuser
js/player.js        # FPS-Controller, Inventar, Kollision
js/building.js      # Raster-Bausystem & Kollisions-AABBs
js/bot.js           # Bot-KI, Statemachine, Bewegung
js/weapons.js       # Waffen-Konfiguration
```
