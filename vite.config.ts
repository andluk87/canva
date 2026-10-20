import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import {readFileSync} from "node:fs";
export default defineConfig({
  plugins: [react(),{name:'forma-offline-shell',generateBundle(_,bundle){
    const assets=Object.keys(bundle).filter(file=>/\.(js|css)$/.test(file)).map(file=>'/'+file);
    const entry=Object.values(bundle).find(file=>file.type==='chunk'&&file.isEntry)?.fileName||'local';
    this.emitFile({type:'asset',fileName:'offline-assets.json',source:JSON.stringify(assets)});
    this.emitFile({type:'asset',fileName:'sw.js',source:readFileSync(new URL('./public/sw-template.js',import.meta.url),'utf8').replace('__VERSION__',entry.replace(/[^a-zA-Z0-9]/g,''))});
  }}],
  server: { proxy: { "/api": { target: "http://127.0.0.1:8192", ws: true } } },
});
