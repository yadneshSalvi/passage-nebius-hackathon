FROM ghcr.io/guidepup/guidepup:0.36.2-ubuntu-resolute-node24@sha256:0353cd6f6c1036c9964ab09fa3ee08936d401609f172f382f9004fda03149a03
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund && npx playwright install --with-deps firefox
# Local compatibility qualification: upstream's userspace Orca asset is indexed
# only for Linux7. Colima runs Linux6.8. Keep the actual OS identity and record
# this explicit manifest extension in every receipt; do not claim upstream support.
RUN node -e 'const fs=require("fs");const p="node_modules/@guidepup/guidepup/manifest.json";const m=JSON.parse(fs.readFileSync(p));const a=m.screenReaders.find(x=>x.id==="orca").assets; a.push({...a.find(x=>x.platformVersion==="7"),platformVersion:"6"});fs.writeFileSync(p,JSON.stringify(m));fs.symlinkSync("/root/.cache/guidepup/orca/7","/root/.cache/guidepup/orca/6")'
# Speech Dispatcher 0.12.1 auto-loads these fallback modules even though
# Guidepup sets a private --module-dir containing only its custom module.
# Missing fallback executables can terminate speech-dispatcher with SIGPIPE
# before the readiness socket exists. Use the actual binaries in the pinned
# upstream image; retain the original Guidepup module, timeout and protocol.
RUN echo "795d48ae97fb41ef1d9b775f68a2521bc5cac72d88d7148fab43e38cc095e8e5  /usr/lib/speech-dispatcher-modules/sd_espeak-ng" | sha256sum -c - && \
    echo "419c9d26f8311889f8a8e2364ca65ba811ca81eff3c8c8197d13d01e018aa407  /usr/lib/speech-dispatcher-modules/sd_dummy" | sha256sum -c - && \
    node -e 'const fs=require("fs");const m=require("./node_modules/@guidepup/guidepup/manifest.json");const a=m.screenReaders.find(x=>x.id==="orca").assets.find(x=>x.platformVersion==="7");const p="/root/.cache/guidepup/orca/7/"+a.version+"/extracted/speechd/modules/";["sd_espeak-ng","sd_dummy"].forEach(n=>fs.symlinkSync("/usr/lib/speech-dispatcher-modules/"+n,p+n))'
RUN chown -R root:root /root/.cache/guidepup
COPY capture.mjs diagnostics.mjs ./
ENV NO_AT_BRIDGE=0
ENV MOZ_ACCESSIBILITY_ATSPI_ENABLED=1
ENV PASSAGE_AT_COMPATIBILITY=local-linux6-userspace-asset-qualification+system-speechd-fallback-links-v3
ENTRYPOINT ["xvfb-run", "-a", "dbus-run-session", "--", "node", "/app/capture.mjs"]
