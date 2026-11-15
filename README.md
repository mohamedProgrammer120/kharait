# Générateur de cartes mentales de séance

Page statique (HTML seul) : charge une séance (PDF, PPTX, DOCX, image, texte ou JSON), Gemini l'analyse et la carte mentale s'affiche, modifiable et imprimable.

- `index.html` : l'application complète
- `sw.js` : cache hors ligne (optionnel)
- `vercel.json` : en-têtes pour Vercel

La clé Gemini est saisie dans la page et reste dans le navigateur ; elle n'est jamais dans le code.
