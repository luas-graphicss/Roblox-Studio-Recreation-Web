const BLEND_TAU = 0.07;                                                   
const WALK_RUN_SPLIT = 8;                                 
const WALK_PHASE_RATE = 0.55;                                                    
const CLIMB_PHASE_RATE = 0.8;
const SWIM_PHASE_RATE = 0.4;                                                     

export function createLocomotion(rigType) {


  const AMP = rigType === "R15" ? 0.85 : 1.0;

  let t = 0;                                                   
  let phase = 0;                                   
  let clip = "idle";


  const cur = { armL: 0, armR: 0, legL: 0, legR: 0, bob: 0 };
  const target = { armL: 0, armR: 0, legL: 0, legR: 0, bob: 0 };

  function poseFor(name) {
    const s = Math.sin(phase);
    switch (name) {
      case "walk": {
        const a = 0.55 * AMP;
        target.armL = -s * a; target.armR = s * a;
        target.legL = s * a; target.legR = -s * a;
        target.bob = Math.abs(Math.cos(phase)) * 0.05;
        break;
      }
      case "run": {
        const a = 0.95 * AMP;
        target.armL = -s * a; target.armR = s * a;
        target.legL = s * a; target.legR = -s * a;
        target.bob = Math.abs(Math.cos(phase)) * 0.12;
        break;
      }
      case "jump":
        target.armL = -1.0 * AMP; target.armR = -1.0 * AMP;
        target.legL = 0.4; target.legR = 0.25;
        target.bob = 0;
        break;
      case "fall": {
        const fl = Math.sin(t * 7) * 0.12;                            
        target.armL = -1.45 * AMP + fl; target.armR = -1.45 * AMP - fl;
        target.legL = 0.25; target.legR = 0.4;
        target.bob = 0;
        break;
      }
      case "climb": {
        const a = 0.5 * AMP;
        target.armL = -1.6 * AMP + s * a; target.armR = -1.6 * AMP - s * a;
        target.legL = -s * a; target.legR = s * a;
        target.bob = 0;
        break;
      }
      case "swim": {


        const a = 0.85 * AMP;
        target.armL = -1.35 * AMP + s * a;
        target.armR = -1.35 * AMP - s * a;
        const kick = Math.sin(phase * 2) * 0.3;
        target.legL = kick; target.legR = -kick;
        target.bob = Math.sin(phase) * 0.06;
        break;
      }
      case "swimidle": {

        const w = Math.sin(t * 2.2);
        target.armL = -0.55 * AMP + w * 0.12;
        target.armR = -0.55 * AMP - w * 0.12;
        target.legL = w * 0.22; target.legR = -w * 0.22;
        target.bob = w * 0.04;
        break;
      }
      case "sit":
        target.armL = -0.2; target.armR = -0.2;
        target.legL = 1.4; target.legR = 1.4;
        target.bob = -0.4;
        break;
      case "idle":
      default: {
        const b = Math.sin(t * 1.7);                      
        target.armL = b * 0.045; target.armR = -b * 0.045;
        target.legL = 0; target.legR = 0;
        target.bob = b * 0.02;
        break;
      }
    }
  }

  return {
    reset() {
      t = 0; phase = 0; clip = "idle";
      cur.armL = cur.armR = cur.legL = cur.legR = cur.bob = 0;
      target.armL = target.armR = target.legL = target.legR = target.bob = 0;
    },


    update(dt, info) {
      t += dt;
      const speed = Math.max(0, Number(info.speed) || 0);
      const st = info.state;
      let next = "idle";
      if (st === "Swimming") next = speed + Math.abs(Number(info.swimVy) || 0) > 1 ? "swim" : "swimidle";             
      else if (st === "Climbing") next = "climb";
      else if (st === "Seated") next = "sit";
      else if (st === "Jumping") next = "jump";
      else if (st === "Freefall" || st === "FallingDown" || st === "Ragdoll" || !info.grounded) next = "fall";
      else if (speed > 0.5) next = speed <= WALK_RUN_SPLIT ? "walk" : "run";
      clip = next;


      if (clip === "walk" || clip === "run") phase += speed * dt * WALK_PHASE_RATE;
      else if (clip === "climb") phase += Math.max(2, Math.abs(Number(info.climbSpeed) || 0)) * dt * CLIMB_PHASE_RATE;
      else if (clip === "swim") phase += Math.max(3, (speed + Math.abs(Number(info.swimVy) || 0)) * SWIM_PHASE_RATE) * dt;             
      else phase = 0;

      poseFor(clip);


      const k = 1 - Math.exp(-dt / BLEND_TAU);
      cur.armL += (target.armL - cur.armL) * k;
      cur.armR += (target.armR - cur.armR) * k;
      cur.legL += (target.legL - cur.legL) * k;
      cur.legR += (target.legR - cur.legR) * k;
      cur.bob += (target.bob - cur.bob) * k;
      return cur;
    },


    pitchFor(limb) {
      if (!limb) return 0;
      if (limb.kind === "arm") return limb.side === 1 ? cur.armL : cur.armR;
      return limb.side === 1 ? cur.legL : cur.legR;
    },

    bob: () => cur.bob,
    clipName: () => clip,



    poseKey() {
      return (
        (cur.armL * 50 | 0) + "|" + (cur.armR * 50 | 0) + "|" +
        (cur.legL * 50 | 0) + "|" + (cur.legR * 50 | 0) + "|" + (cur.bob * 100 | 0)
      );
    },
  };
}
