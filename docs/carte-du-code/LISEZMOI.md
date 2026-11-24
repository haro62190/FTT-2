# 🗺️ Carte du code de Kensei (générée avec Graphify)

Ouvre ces fichiers dans ton navigateur (double-clic) :

- **`graphe.html`** — la carte interactive : 514 éléments (fonctions, fichiers) reliés par 1 230 liens, regroupés en 19 ensembles colorés (cœur du bot, construction du serveur, sécurité, tableau de bord, tickets…). Clique sur un point pour voir ce qu'il fait et à quoi il est relié ; coche / décoche les ensembles à droite.
- **`architecture.html`** — les schémas d'architecture et d'appels entre modules.
- **`RAPPORT.md`** — le résumé : éléments les plus centraux (`save()`, `findChannel()`, `findRole()`…), liens surprenants, aucune dépendance circulaire.

Les fichiers HTML chargent leur bibliothèque de dessin depuis Internet (unpkg / jsDelivr).

Régénérer après des modifications :

```bash
pip install graphifyy
graphify extract . --code-only    # analyse locale, sans clé d'API
graphify cluster-only .           # rapport + noms des ensembles
graphify export html
graphify export callflow-html
```
