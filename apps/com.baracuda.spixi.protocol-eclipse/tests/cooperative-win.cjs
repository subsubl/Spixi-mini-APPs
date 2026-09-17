/* Run against the static app: GAME_URL=http://127.0.0.1:8770/ node tests/cooperative-win.cjs
 * Set PLAYWRIGHT_MODULE if Playwright is installed outside this package.
 * Only the native transport boundary is simulated. No game state or answers injected.
 */
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.GAME_URL || 'http://127.0.0.1:8770/';

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const errors = [], messages = [];
  let phase = 'setup';
  try {
    const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
    const pages = await Promise.all(contexts.map(c => c.newPage()));
    const addresses = ['test-operative', 'test-z-dispatcher'];
    const loaded = [false, false];
    const queues = [Promise.resolve(), Promise.resolve()];
    for (let i = 0; i < 2; i++) {
      pages[i].setDefaultTimeout(12000);
      pages[i].on('pageerror', e => errors.push(`peer ${i}: ${e.message}`));
      await pages[i].exposeFunction('testSendNetworkData', data => {
        if (!loaded[1-i]) return;
        const message = JSON.parse(data);
        messages.push({ from: i, type: message.type, action: message.payload?.action });
        queues[i] = queues[i].then(() => pages[1-i].evaluate(({ sender, data }) => {
          window.SpixiAppSdk.onNetworkData(sender, data);
        }, { sender: addresses[i], data })).catch(e => errors.push(`transport: ${e.message}`));
      });
      await pages[i].route('**/spixi-app-sdk.js', async route => {
        const response = await route.fetch();
        await route.fulfill({ response, body: (await response.text()) +
          '\nSpixiAppSdk.fireOnLoad = () => {};\nSpixiAppSdk.sendNetworkData = data => window.testSendNetworkData(data);\n' });
      });
    }
    await Promise.all(pages.map(async (p, i) => {
      await p.goto(base, { waitUntil: 'load' });
      loaded[i] = true;
    }));
    for (let i=0; i<2; i++) await pages[i].evaluate(({ me, peer }) => {
      SpixiAppSdk.onInit('cooperative-win-session', me, peer);
    }, { me: addresses[i], peer: addresses[1-i] });
    const [op, dispatcher] = pages;
    phase = 'both peers connected with complementary roles';
    for (const p of pages) await p.waitForFunction(() => document.getElementById('status-text').textContent.includes('P2P linked'));
    assert.equal(await op.locator('#role-badge').innerText(), 'OPERATIVE');
    assert.equal(await dispatcher.locator('#role-badge').innerText(), 'DISPATCHER');
    console.log('PASS: both peers connected; complementary roles');

    phase = 'sector 1 using dispatcher frequency and wire-order clues';
    const frequency = Number((await dispatcher.locator('#disp-target-freq').innerText()).match(/\d+/)[0]);
    const wires = (await dispatcher.locator('#disp-wire-order').innerText()).split('➔').map(s=>s.trim());
    await op.locator('#op-freq-slider').fill(String(frequency));
    await dispatcher.waitForFunction(f => document.getElementById('disp-op-freq').textContent === `${f} Hz`, frequency);
    for (const wire of wires) await op.locator(`.btn-wire[data-color="${wire}"]`).click();
    await dispatcher.waitForFunction(expected => document.getElementById('disp-op-wire').textContent === expected, wires.join(' ➔ '));
    await dispatcher.locator('#disp-send-pulse').click();
    await op.locator('#op-loop2-panel.active').waitFor({state:'visible'});
    await dispatcher.locator('#tab-pressure.active').waitFor({state:'visible'});
    console.log('PASS: frequency and wires solved through UI; both peers enter sector 2');

    phase = 'sector 2 using real advancing pressure and dispatcher valve clue';
    const valve = (await dispatcher.locator('#disp-target-valve').innerText()).match(/VALVE ([ABC])/)[1];
    const pressure = (await dispatcher.locator('#disp-target-psi').innerText()).match(/\d+/g).map(Number);
    const center = (pressure[0] + pressure[1]) / 2;
    await op.waitForFunction(target => Number(document.getElementById('gauge-val').textContent.match(/\d+/)[0]) >= target, center, {timeout:25000});
    const button = op.locator(`#op-valve-${valve.toLowerCase()}`);
    await button.hover();
    await op.mouse.down();
    await dispatcher.waitForFunction(v => document.getElementById('disp-op-valve').textContent === `VALVE ${v}`, valve);
    await dispatcher.locator('#disp-trigger-vent').click();
    await op.mouse.up();
    await op.locator('#op-loop3-panel.active').waitFor({state:'visible'});
    await dispatcher.locator('#tab-cipher.active').waitFor({state:'visible'});
    console.log('PASS: timed valve override solved through UI; both peers enter sector 3');

    phase = 'sector 3 decoding operative glyphs with dispatcher dictionary';
    const glyphs = (await op.locator('#op-glyphs').innerText()).split('•').map(s=>s.trim());
    const dictionary = {};
    for (const row of await dispatcher.locator('#cipher-dictionary > div').allTextContents()) {
      const [glyph, digit] = row.split('→').map(s=>s.trim()); dictionary[glyph] = digit;
    }
    const digits = glyphs.map(g => { assert.match(dictionary[g], /^\d$/); return dictionary[g]; });
    await dispatcher.locator('#disp-send-auth').click();
    await dispatcher.waitForFunction(() => document.getElementById('disp-token-sent').textContent === 'YES');
    for (const digit of digits) await op.locator('.btn-num').filter({hasText:new RegExp(`^${digit}$`)}).click();
    assert.equal(await op.locator('#op-keypad-code').inputValue(), digits.join(''));
    await op.locator('#btn-num-ent').click();
    for (const p of pages) await p.locator('#victory-screen.active').waitFor({state:'visible'});
    assert.equal(await op.locator('#vic-time').innerText(), await dispatcher.locator('#vic-time').innerText());
    assert.deepEqual(errors, []);
    for (const action of ['pulse','vent','authorize']) assert.ok(messages.some(m=>m.from===1 && m.action===action),`peer action exchanged: ${action}`);
    assert.ok(messages.some(m=>m.from===0 && m.type==='snapshot'));
    console.log('PASS: shared victory with identical elapsed time');
    phase = 'restart from guest, shared failure, and role swaps';
    await dispatcher.locator('#btn-play-again').click();
    for(const p of pages) await p.locator('#victory-screen.active').waitFor({state:'hidden'});
    await dispatcher.locator('#tab-freq.active').waitFor({state:'visible'});
    for(let i=0;i<5;i++) {
      await dispatcher.locator('#disp-send-pulse').click();
      if(i<4) await dispatcher.waitForFunction(n=>document.getElementById('disp-objective').textContent.includes(`${n}/5`),i+1);
    }
    for(const p of pages) await p.locator('#gameover-screen.active').waitFor({state:'visible'});
    await dispatcher.locator('#btn-retry-game').click();
    await op.locator('#op-loop1-panel.active').waitFor({state:'visible'});
    await op.locator('#btn-swap-role').click();
    await dispatcher.waitForFunction(()=>document.getElementById('role-badge').textContent==='OPERATIVE');
    assert.equal(await op.locator('#role-badge').innerText(),'DISPATCHER');
    await dispatcher.locator('#btn-swap-role').click();
    await op.waitForFunction(()=>document.getElementById('role-badge').textContent==='OPERATIVE');
    console.log('PASS: guest restart, shared game-over, retry, swaps both directions');
    phase = 'mobile layout';
    for(const p of pages) {
      await p.setViewportSize({width:390,height:844});
      assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow');
      const controls=await p.locator('button:visible').evaluateAll(elements=>elements.map(e=>({height:e.getBoundingClientRect().height,width:e.getBoundingClientRect().width})));
      assert.ok(controls.every(c=>c.height>=44 && c.width>=44),'44px touch targets');
    }
    console.log('PASS: both roles at 390x844, no overflow and 44px controls');
    phase = 'guest reload and snapshot resynchronization';
    loaded[1]=false;
    await dispatcher.reload({waitUntil:'load'}); loaded[1]=true;
    await dispatcher.evaluate(({me,peer})=>SpixiAppSdk.onInit('cooperative-win-session',me,peer),{me:addresses[1],peer:addresses[0]});
    await dispatcher.waitForFunction(()=>document.getElementById('status-text').textContent.includes('P2P linked'));
    await dispatcher.locator('#dispatcher-viewport.active').waitFor({state:'visible'});
    assert.equal(await dispatcher.locator('#disp-op-freq').innerText(),await op.locator('#op-freq-val').innerText());
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({status:'PASS',sectorsCompleted:3,victoriousPeers:2,restartAndFailure:true,mobile:true,guestReload:true,answers:'derived exclusively from visible UI clues',gameStateInjection:false,transport:'ordered local SDK-message relay, not native Spixi',messages:messages.length,pageErrors:errors},null,2));
  } catch (error) {
    console.error(`FAIL at ${phase}: ${error.message}`);
    if(errors.length) console.error(JSON.stringify(errors));
    process.exitCode = 1;
  } finally { await browser.close(); }
})();
