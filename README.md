# Roblox Studio Web

[Leia em português](README.pt-BR.md)

Roblox Studio Web is a recreation of Roblox Studio that runs in the browser. It has the explorer, the properties panel, the 3D viewport, the script editor and the output, and the idea is that anyone who has used the real Studio feels at home without installing anything.

The project goes well beyond the interface. There is a data model with services and instances, a Luau virtual machine that runs scripts inside the page, a physics engine, terrain, avatars, animation, audio and a large lighting system with layered materials, support for many dynamic lights and cinematic post processing. The script editor uses Monaco and the viewport uses three.js. Around that there is a debugger, a developer console, plugins, packages, Team Create style collaboration with drafts and version history, publishing through Open Cloud and an AI code assistant that keeps API keys in a local vault and strips secrets before sending anything.

This is an independent project and has no connection with Roblox Corporation.

## How to use

You need Node.js 18 or newer. Clone the repository, run npm install and then npm run dev, and open the address Vite prints in the terminal, usually localhost on port 5173. For a production build run npm run build, and npm run preview serves that build locally. The index.html file can also be opened on its own as a static page.

There are a couple of security scripts too. npm run security:integrity recalculates the integrity hashes of the third party files and npm run security:audit checks the dependencies.

## Development time

The project took about six months so far and it is still in development, so some features are missing and changes happen often.

## License

GNU General Public License version 3. The full text is in the LICENSE file.
