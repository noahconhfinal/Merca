# Merca 🛒

Lista de la compra compartida para el equipo. Cuando alguien va al Mercadona, todos pueden añadir lo que necesitan.

## Funcionalidades

- Añadir productos a la lista con cantidad y notas
- Marcar productos como comprados
- Botón "¡Voy al Mercadona!" para avisar al equipo
- Historial de compras
- PWA instalable en móvil
- Refresco automático cada 10 segundos

## Uso local

```bash
npm install
npm start
```

Abre http://localhost:3000

## Despliegue en Cloudron

```bash
cloudron build
cloudron install
```

## Tecnología

- **Backend:** Node.js + Express + SQLite (better-sqlite3)
- **Frontend:** HTML/CSS/JS vanilla (sin frameworks)
- **PWA:** Service Worker + Web App Manifest
