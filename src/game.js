import * as THREE from 'https://unpkg.com/three@0.160.1/build/three.module.js';
import { GLTFLoader } from 'https://unpkg.com/three@0.160.1/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from 'https://esm.sh/@pixiv/three-vrm@2.1.2?bundle&external=three';

const PARTNER_ID = 'partner_7221bbc0ac8f1c30';
const canvas = document.querySelector('#game-canvas');
const startPanel = document.querySelector('#start-panel');
const status = document.querySelector('#sdk-status');
const relicCount = document.querySelector('#relic-count');
const timer = document.querySelector('#timer');
const missionText = document.querySelector('#mission-text');
const toast = document.querySelector('#toast');

const scene = new THREE.Scene();
scene.background = new THREE.Color('#070b1f');
scene.fog = new THREE.FogExp2('#070b1f', 0.025);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.shadowMap.enabled = true;

scene.add(new THREE.HemisphereLight(0xaecbff, 0x17102e, 2.2));
const keyLight = new THREE.DirectionalLight(0xe6ddff, 2.4);
keyLight.position.set(7, 10, 4);
keyLight.castShadow = true;
scene.add(keyLight);

const loader = new GLTFLoader();
loader.crossOrigin = 'anonymous';
loader.register((parser) => new VRMLoaderPlugin(parser));

let sdk;
let controller;
let currentVrm;
let pausedBySdk = false;
let avatarLoading = false;
let hasAvatar = false;
let controlsHint = {};
let frameId = 0;
let elapsed = 0;
let gameStarted = false;
const clock = new THREE.Clock();
const relics = [];

createWorld();
await initializeGame();

async function initializeGame() {
  try {
    const api = await waitForSdk();
    sdk = await api.init({
      mode: 'sdk-happy-path',
      target: '#viverse-me-button-slot',
      partnerId: PARTNER_ID,
      userId: getDemoPlayerId(),
      label: 'CHOOSE AVATAR',
      locale: 'zh-TW',
      happyPath: {
        copy: { title: '選擇探索者', createLabel: '建立角色' },
        cards: { savedAvatarFetchLimit: 3, savedAvatarDisplayLimit: 3 },
        theme: { panelBackground: 'rgba(10, 13, 39, 0.97)', titleColor: '#f5f4ff', cardBackground: 'rgba(36, 26, 74, 0.86)' }
      }
    });
    if (!sdk) throw new Error('SDK authorization was denied.');

    const { createAvatarController } = await import(api.avatarControllerUrl);
    controller = createAvatarController({
      scene,
      domElement: canvas,
      animations: api.animations,
      enableAnimation: true,
      enableControl: true,
      physics: 'builtin',
      groundY: 0
    });
    controller.setJoystickVisible(false);
    resize();
    status.textContent = '角色選擇器已準備完成';
    resume();
  } catch (error) {
    console.error(error);
    status.textContent = '無法啟動角色選擇器：請確認此網站網址已加入 VIVERSE Allowed Websites。';
  }
}

function waitForSdk() {
  if (window.ViverseMeSDK) return Promise.resolve(window.ViverseMeSDK);
  const script = document.querySelector('#viverse-sdk');
  return new Promise((resolve, reject) => {
    script.addEventListener('load', () => resolve(window.ViverseMeSDK), { once: true });
    script.addEventListener('error', () => reject(new Error('VIVERSE SDK failed to load.')), { once: true });
  });
}

function getDemoPlayerId() {
  const key = 'neon-relic-run-player-id';
  let id = localStorage.getItem(key);
  if (!id) {
    id = `neon-runner-${crypto.randomUUID()}`;
    localStorage.setItem(key, id);
  }
  return id;
}

window.addEventListener('viverse-me:open', () => {
  pausedBySdk = true;
  controller?.setEnableControl(false);
  controller?.setJoystickVisible(false);
  cancelAnimationFrame(frameId);
  frameId = 0;
});

window.addEventListener('viverse-me:close', () => {
  pausedBySdk = false;
  applyControls();
  controller?.setJoystickVisible(hasAvatar && !avatarLoading);
  resume();
});

window.addEventListener('viverse-me:avatar-selected', async ({ detail }) => {
  const avatar = detail.avatar;
  if (!avatar?.vrmUrl || !controller || avatarLoading) return;
  avatarLoading = true;
  controller.setJoystickVisible(false);
  status.textContent = '正在載入角色…';
  await Promise.resolve();
  sdk.showLoading?.('Loading avatar...');

  try {
    const gltf = await loader.loadAsync(avatar.vrmUrl);
    const nextVrm = gltf.userData.vrm;
    if (!nextVrm) throw new Error('選取的資源不是有效的 VRM。');

    VRMUtils.removeUnnecessaryVertices(gltf.scene);
    VRMUtils.removeUnnecessaryJoints(gltf.scene);
    const previousVrm = currentVrm;
    controller.setAvatar(null);
    currentVrm = nextVrm;
    controller.setAvatar(nextVrm, avatar.animations || null);
    if (previousVrm) VRMUtils.deepDispose(previousVrm.scene);

    hasAvatar = true;
    applyControls(avatar.controlsHint);
    startPanel.classList.add('is-hidden');
    if (!gameStarted) {
      gameStarted = true;
      showToast('星港已解鎖：收集所有能量遺物！');
    } else {
      showToast('角色已更換，冒險繼續。');
    }
  } catch (error) {
    console.error('Unable to load selected avatar:', error);
    status.textContent = '角色載入失敗，請重新選擇。';
    showToast('角色載入失敗，請重新選擇。');
  } finally {
    avatarLoading = false;
    sdk.hideLoading?.();
    controller?.setJoystickVisible(hasAvatar && !pausedBySdk);
  }
});

window.addEventListener('viverse-me:controls-changed', ({ detail }) => {
  applyControls(detail.controls || detail);
});

window.addEventListener('viverse-me:authorization-denied', ({ detail }) => {
  status.textContent = `授權失敗：${detail.message || '請將目前網站 origin 加入 Allowed Websites。'}`;
});

function applyControls(hint = {}) {
  if (!controller) return;
  controlsHint = { ...controlsHint, ...hint };
  const animationEnabled = controlsHint.animationEnabled !== false;
  controller.setEnableAnimation(animationEnabled);
  controller.setEnableControl(!pausedBySdk && animationEnabled && controlsHint.controlEnabled !== false);
  if (controlsHint.controllerSize !== undefined) controller.setControllerSize(controlsHint.controllerSize);
}

function createWorld() {
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(35, 96),
    new THREE.MeshStandardMaterial({ color: '#101633', roughness: 0.82, metalness: 0.22 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const grid = new THREE.GridHelper(64, 32, '#40377b', '#191b43');
  grid.position.y = 0.012;
  scene.add(grid);

  const ringMaterial = new THREE.MeshBasicMaterial({ color: '#8b5cf6', transparent: true, opacity: 0.36 });
  [7, 14, 22, 30].forEach((radius) => {
    const ring = new THREE.Mesh(new THREE.RingGeometry(radius - .025, radius + .025, 96), ringMaterial);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    scene.add(ring);
  });

  const skyline = new THREE.Group();
  for (let i = 0; i < 22; i += 1) {
    const angle = (i / 22) * Math.PI * 2;
    const radius = 27 + (i % 3) * 3;
    const height = 3 + (i % 5) * 1.7;
    const tower = new THREE.Mesh(
      new THREE.CylinderGeometry(.45 + (i % 2) * .2, .75, height, 6),
      new THREE.MeshStandardMaterial({ color: i % 2 ? '#251a58' : '#172c62', emissive: i % 2 ? '#39147a' : '#0b3d91', emissiveIntensity: .5, metalness: .75, roughness: .28 })
    );
    tower.position.set(Math.cos(angle) * radius, height / 2, Math.sin(angle) * radius);
    skyline.add(tower);
  }
  scene.add(skyline);

  const relicPositions = [[5, 4], [-6, 3], [9, -7], [-8, -7], [15, 2], [-15, 0], [2, 14], [-2, -15]];
  relicPositions.forEach(([x, z], index) => createRelic(x, z, index));
}

function createRelic(x, z, index) {
  const relic = new THREE.Group();
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(.38, 0), new THREE.MeshStandardMaterial({ color: '#e9d5ff', emissive: '#a855f7', emissiveIntensity: 3, metalness: .3, roughness: .15 }));
  const halo = new THREE.Mesh(new THREE.TorusGeometry(.68, .025, 8, 30), new THREE.MeshBasicMaterial({ color: '#67e8f9', transparent: true, opacity: .8 }));
  halo.rotation.x = Math.PI / 2;
  relic.add(core, halo);
  relic.position.set(x, 1.1, z);
  relic.userData = { index, collected: false, phase: index * .8 };
  scene.add(relic);
  relics.push(relic);
}

function updateRelics(time) {
  for (const relic of relics) {
    if (relic.userData.collected) continue;
    relic.rotation.y += .025;
    relic.position.y = 1.1 + Math.sin(time * 2 + relic.userData.phase) * .18;
    if (hasAvatar && controller?.anchor.position.distanceToSquared(relic.position) < 2.2) {
      relic.userData.collected = true;
      relic.visible = false;
      const collected = relics.filter((item) => item.userData.collected).length;
      relicCount.textContent = `${collected} / ${relics.length}`;
      showToast(`遺物 ${collected}/${relics.length} 已取得`);
      if (collected === relics.length) {
        missionText.textContent = '任務完成！你已收集所有能量遺物。';
        showToast('任務完成：星港能量已恢復！');
      }
    }
  }
}

function render() {
  frameId = 0;
  if (pausedBySdk || !controller) return;
  const delta = Math.min(clock.getDelta(), .05);
  controller.update(delta);
  if (gameStarted) {
    elapsed += delta;
    timer.textContent = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(Math.floor(elapsed % 60)).padStart(2, '0')}`;
  }
  updateRelics(elapsed);
  renderer.render(scene, controller.camera);
  frameId = requestAnimationFrame(render);
}

function resume() {
  if (frameId || pausedBySdk || !controller) return;
  clock.getDelta();
  frameId = requestAnimationFrame(render);
}

function resize() {
  if (!controller) return;
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setSize(width, height, false);
  controller.camera.aspect = width / height;
  controller.camera.updateProjectionMatrix();
}

let toastTimeout;
function showToast(message) {
  toast.textContent = message;
  toast.classList.add('is-visible');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove('is-visible'), 2800);
}

window.addEventListener('resize', resize);
window.addEventListener('beforeunload', () => {
  controller?.dispose();
  if (currentVrm) VRMUtils.deepDispose(currentVrm.scene);
  sdk?.destroy();
});