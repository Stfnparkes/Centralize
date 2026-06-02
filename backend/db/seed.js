// Idempotent seeder — populates users + canonical KV entities on first boot.
// Re-running is safe: existing rows are left alone.
const { kvSet, upsertUser, kvHasPrefix } = require('../lib/db');
const { hashPassword } = require('../lib/auth');

// Demo credentials — these are the only login passwords seeded for the
// prototype. Documented in the README + shown on the login page.
const DEMO_PWD = {
  coach:   'coach123',
  trainer: 'trainer123',
  player:  'player123',
};


const ROSTER = [
  { id:'pl-1',  number:4,  name:'M. Anderson', position:'PG' },
  { id:'pl-2',  number:7,  name:'D. Wilson',   position:'SG' },
  { id:'pl-3',  number:23, name:'J. Carter',   position:'SF' },
  { id:'pl-4',  number:32, name:'K. Brown',    position:'PF' },
  { id:'pl-5',  number:55, name:'L. Mitchell', position:'C'  },
  { id:'pl-6',  number:1,  name:'A. Thompson', position:'PG' },
  { id:'pl-7',  number:11, name:'R. Davis',    position:'SG' },
  { id:'pl-8',  number:21, name:'C. Martinez', position:'SF' },
  { id:'pl-9',  number:34, name:'B. White',    position:'PF' },
  { id:'pl-10', number:42, name:'T. Hall',     position:'C'  },
];

const GAMES = [
  { id:'gm-1', opponent:'Riverside Knights', date:'2026-05-09', season:'2025-26', homeAway:'home', teamScore:89, oppScore:88, status:'completed' },
  { id:'gm-2', opponent:'Eastside Eagles',   date:'2026-05-04', season:'2025-26', homeAway:'away', teamScore:76, oppScore:81, status:'completed' },
  { id:'gm-3', opponent:'Central Tigers',    date:'2026-05-18', season:'2025-26', homeAway:'home', teamScore:null, oppScore:null, status:'scheduled' },
  { id:'gm-4', opponent:'Northgate Wolves',  date:'2026-04-26', season:'2025-26', homeAway:'home', teamScore:93, oppScore:78, status:'completed' },
  { id:'gm-5', opponent:'Harbor Sharks',     date:'2026-04-19', season:'2025-26', homeAway:'away', teamScore:71, oppScore:69, status:'completed' },
];

const TEAM_PROFILE = {
  id:'team:default', name:'Centralize Crusaders', coach:'Coach R. Patterson',
  colour:'#0d9488', season:'2025-26',
  offensivePlays:'Princeton, 5-Out, Spain PnR',
  defensivePlays:'Pack-Line, 2-3 Zone, Switch Everything',
};

function seedUsers() {
  const now = Date.now();
  // Only hash + upsert when the user record is missing — keeps reseeds idempotent.
  const { userById } = require('../lib/db');
  function seedIfNew(u) {
    if (userById(u.id) && userById(u.id).password_hash) return;
    upsertUser({ ...u, password_hash: hashPassword(u.__pwd), created_at: now });
  }
  seedIfNew({ id:'coach-1',   role:'coach',   name:'Coach R. Patterson', player_id: null, email:'coach@team.example',   __pwd: DEMO_PWD.coach });
  seedIfNew({ id:'trainer-1', role:'trainer', name:'Trainer S. Wells',   player_id: null, email:'trainer@team.example', __pwd: DEMO_PWD.trainer });
  for (const p of ROSTER) {
    seedIfNew({ id:`user-${p.id}`, role:'player', name:p.name, player_id:p.id, email:`${p.id}@team.example`, __pwd: DEMO_PWD.player });
  }
}

function seedIfEmpty(prefix, items) {
  // If the prefix has any existing rows, leave it alone.
  if (kvHasPrefix(prefix)) return 0;
  let n = 0;
  for (const it of items) {
    kvSet(prefix, it.id, JSON.stringify(it), 'system');
    n++;
  }
  return n;
}

function seedKv() {
  seedIfEmpty('roster', ROSTER);
  seedIfEmpty('games', GAMES);
  seedIfEmpty('teamProfile', [TEAM_PROFILE]);

  // Player profiles
  const profiles = ROSTER.map((p, i) => ({
    id:`pp-${p.id}`, playerId:p.id,
    fullName: ({
      'pl-1':'Marcus Anderson','pl-2':'Devon Wilson','pl-3':'Jordan Carter','pl-4':'Kevon Brown','pl-5':'Lewis Mitchell',
      'pl-6':'Aiden Thompson','pl-7':'Ryan Davis','pl-8':'Carlos Martinez','pl-9':'Brandon White','pl-10':'Tyrese Hall',
    })[p.id],
    age: 19 + (i % 6), height: ["6'2\"","6'4\"","6'6\"","6'8\"","6'11\"","5'11\"","6'3\"","6'5\"","6'9\"","6'10\""][i],
    weight: 172 + i*8, contactPhone:`555-01${String(p.number).padStart(2,'0')}`, contactEmail:`${p.id}@team.example`,
    dateOfBirth: `200${5 - (i % 6)}-0${(i % 9) + 1}-${10 + (i % 18)}`,
    jerseyNumber: p.number, position: p.position,
    verified: i % 3 !== 2,
    verifiedBy: i % 3 !== 2 ? 'Coach R. Patterson' : null,
    verifiedAt: i % 3 !== 2 ? Date.now() - 86400000 * (7 + i * 3) : null,
    photoDataUrl: null,
    bio: ({
      'pl-1':'Floor general. 4-year starter at point.',
      'pl-2':'Sharpshooter. Three-time conference all-star.',
      'pl-3':'Two-way wing. Always asks for the matchup.',
      'pl-4':'Captain. Rebounds for everyone.',
      'pl-5':'Rim protector. Career-high 7 blocks.',
      'pl-6':'Freshman. Quick first step.',
      'pl-7':'Hustle stats off the charts.',
      'pl-8':'Versatile defender. 1-4 switchable.',
      'pl-9':'Pick-and-pop big. Stretch four.',
      'pl-10':'Skilled five. Soft hands on the roll.',
    })[p.id],
  }));
  seedIfEmpty('playerProfiles', profiles);

  // Per-game stat lines (mirror the formula used in the frontend seeds)
  const completed = ['gm-1','gm-2','gm-4','gm-5'];
  const stats = [];
  let n = 0;
  for (const gid of completed) {
    for (const p of ROSTER) {
      n++;
      const base = (['pl-1','pl-2','pl-3','pl-4','pl-5'].includes(p.id)) ? 1.0 : 0.55;
      const seed = (n * 7919) % 97;
      const r = (k) => ((seed * (k+1)) % 11) / 10;
      stats.push({
        id:`gs-${gid}-${p.id}`, gameId:gid, playerId:p.id,
        min: Math.round((20 + r(0)*16) * base),
        pts: Math.round((10 + r(1)*18) * base),
        ast: Math.round((2 + r(2)*7) * (p.position==='PG'?1.4: p.position==='SG'?1.05:0.7)),
        reb: Math.round((3 + r(3)*8) * (p.position==='C'?1.5: p.position==='PF'?1.3:0.7)),
        stl: Math.round(r(4)*3),
        blk: Math.round((p.position==='C'||p.position==='PF') ? r(5)*3 : r(5)*1),
        fga: Math.round((8 + r(6)*10) * base), fgm: Math.round((4 + r(7)*6) * base),
        tpa: Math.round(r(8)*7 * (p.position==='C'?0.2:1)), tpm: Math.round(r(9)*4 * (p.position==='C'?0.2:1)),
        fta: Math.round(r(0)*5), ftm: Math.round(r(1)*4),
        tov: Math.round(r(2)*3), pf:  Math.round(r(3)*4),
      });
    }
  }
  seedIfEmpty('gameStats', stats);

  seedIfEmpty('teamStats', [
    { id:'ts-gm-1', gameId:'gm-1', fgPct:48.2, tpPct:37.5, ftPct:81.0, reb:42, ast:21, tov:11, stl:8,  blk:5 },
    { id:'ts-gm-2', gameId:'gm-2', fgPct:41.0, tpPct:29.2, ftPct:74.1, reb:38, ast:16, tov:15, stl:6,  blk:3 },
    { id:'ts-gm-4', gameId:'gm-4', fgPct:51.4, tpPct:42.1, ftPct:78.9, reb:46, ast:25, tov:9,  stl:11, blk:7 },
    { id:'ts-gm-5', gameId:'gm-5', fgPct:44.7, tpPct:31.0, ftPct:82.5, reb:39, ast:18, tov:13, stl:7,  blk:4 },
  ]);

  // Canonical 5 plays (matching coach module)
  seedIfEmpty('plays', [
    { id:'play-pnr-right', name:'Pick-and-Roll — Right Wing', side:'offense', category:'Set Plays', tags:['PnR','Half Court'],
      description:'Right-wing PnR — 5 sets the screen for 1; read defense for roll, pop, or kick-out.',
      courtTemplate:'half', sharedAt: Date.now() - 86400000*2, sharedBy:'Coach R. Patterson',
      phases:[
        { id:'ph-1', label:'Setup',                       positions:{ o1:{x:330,y:300}, o2:{x:80,y:230}, o3:{x:420,y:200}, o4:{x:165,y:95}, o5:{x:330,y:230} }, drawings:[] },
        { id:'ph-2', label:'5 sets screen on 1’s defender', positions:{ o1:{x:330,y:300}, o2:{x:80,y:230}, o3:{x:420,y:200}, o4:{x:165,y:95}, o5:{x:320,y:280} }, drawings:[{ type:'screen', x1:320, y1:280, x2:330, y2:300 }] },
        { id:'ph-3', label:'1 attacks, 5 rolls',         positions:{ o1:{x:380,y:220}, o2:{x:80,y:230}, o3:{x:420,y:200}, o4:{x:165,y:95}, o5:{x:280,y:160} }, drawings:[{ type:'move', x1:330, y1:300, x2:380, y2:220 },{ type:'move', x1:320, y1:280, x2:280, y2:160 }] },
        { id:'ph-4', label:'Pocket pass to roller',      positions:{ o1:{x:380,y:220}, o2:{x:80,y:230}, o3:{x:420,y:200}, o4:{x:165,y:95}, o5:{x:250,y:90}  }, drawings:[{ type:'pass', x1:380, y1:220, x2:250, y2:90 }] },
      ],
    },
    { id:'play-horns', name:'Horns Flex', side:'offense', category:'Set Plays', tags:['Set Play','Half Court'],
      description:'Horns alignment — flex cut from corner uses the high-post big as a screener.',
      courtTemplate:'half', sharedAt: Date.now() - 86400000*4, sharedBy:'Coach R. Patterson',
      phases:[
        { id:'ph-1', label:'Horns set',           positions:{ o1:{x:250,y:380}, o2:{x:60,y:140}, o3:{x:440,y:140}, o4:{x:175,y:160}, o5:{x:325,y:160} }, drawings:[] },
        { id:'ph-2', label:'2 flex-cuts off 5',   positions:{ o1:{x:250,y:380}, o2:{x:250,y:80}, o3:{x:440,y:140}, o4:{x:175,y:160}, o5:{x:325,y:160} }, drawings:[{ type:'move', x1:60, y1:140, x2:250, y2:80 },{ type:'screen', x1:325, y1:160, x2:250, y2:80 }] },
        { id:'ph-3', label:'Skip-and-pop',        positions:{ o1:{x:200,y:340}, o2:{x:250,y:80}, o3:{x:440,y:140}, o4:{x:120,y:230}, o5:{x:325,y:160} }, drawings:[{ type:'pass', x1:200, y1:340, x2:250, y2:80 }] },
      ],
    },
    { id:'play-5out', name:'5-Out Motion Open', side:'offense', category:'Continuity', tags:['Motion','Continuity'],
      description:'Free-flowing 5-out motion. Read-and-react.',
      courtTemplate:'half', sharedAt: Date.now() - 86400000*6, sharedBy:'Coach R. Patterson',
      phases:[
        { id:'ph-1', label:'5-Out alignment',     positions:{ o1:{x:250,y:390}, o2:{x:60,y:290}, o3:{x:440,y:290}, o4:{x:100,y:110}, o5:{x:400,y:110} }, drawings:[] },
        { id:'ph-2', label:'Pass + basket cut',   positions:{ o1:{x:60,y:290},  o2:{x:250,y:120}, o3:{x:440,y:290}, o4:{x:100,y:110}, o5:{x:400,y:110} }, drawings:[{ type:'pass', x1:250, y1:390, x2:60, y2:290 },{ type:'move', x1:250, y1:390, x2:250, y2:120 }] },
      ],
    },
    { id:'play-princeton', name:'Princeton High Post', side:'offense', category:'Continuity', tags:['Continuity'],
      description:'Princeton continuity — entry to high-post hub.',
      courtTemplate:'half', sharedAt: Date.now() - 86400000*8, sharedBy:'Coach R. Patterson',
      phases:[
        { id:'ph-1', label:'Setup',                    positions:{ o1:{x:250,y:360}, o2:{x:100,y:230}, o3:{x:400,y:230}, o4:{x:200,y:110}, o5:{x:300,y:110} }, drawings:[] },
        { id:'ph-2', label:'Chin entry',               positions:{ o1:{x:170,y:300}, o2:{x:100,y:230}, o3:{x:400,y:230}, o4:{x:250,y:160}, o5:{x:300,y:110} }, drawings:[{ type:'pass', x1:170, y1:300, x2:250, y2:160 }] },
        { id:'ph-3', label:'Split + backdoor cut',     positions:{ o1:{x:330,y:280}, o2:{x:100,y:230}, o3:{x:400,y:230}, o4:{x:200,y:180}, o5:{x:250,y:60}  }, drawings:[{ type:'pass', x1:200, y1:180, x2:250, y2:60 },{ type:'screen', x1:200, y1:180, x2:330, y2:280 }] },
      ],
    },
    { id:'play-blob', name:'BLOB Box-1', side:'offense', category:'Inbounds', tags:['Inbounds','Baseline'],
      description:'Baseline out-of-bounds — box set with 1 as inbounder.',
      courtTemplate:'half', sharedAt: Date.now() - 86400000*10, sharedBy:'Coach R. Patterson',
      phases:[
        { id:'ph-1', label:'Box set',                positions:{ o1:{x:250,y:8}, o2:{x:175,y:160}, o3:{x:325,y:160}, o4:{x:175,y:60}, o5:{x:325,y:60} }, drawings:[] },
        { id:'ph-2', label:'4 cross-screens for 2',  positions:{ o1:{x:250,y:8}, o2:{x:325,y:160}, o3:{x:325,y:160}, o4:{x:240,y:140}, o5:{x:325,y:60} }, drawings:[{ type:'screen', x1:240, y1:140, x2:175, y2:160 },{ type:'move', x1:175, y1:160, x2:325, y2:160 }] },
      ],
    },
  ]);

  // Training sessions
  seedIfEmpty('training', [
    { id:'tr-1', title:'Princeton Install',          date:'2026-05-17', startTime:'10:00', endTime:'12:00', location:'Practice Gym A', objectives:'Backdoor cuts + chin entries. Light contact.', createdBy:'Coach R. Patterson' },
    { id:'tr-2', title:'Defensive Shell',            date:'2026-05-18', startTime:'10:00', endTime:'12:00', location:'Practice Gym A', objectives:'4v4 shell w/ ICE coverage. Communication focus.', createdBy:'Coach R. Patterson' },
    { id:'tr-3', title:'Walk-Through (Tigers)',      date:'2026-05-19', startTime:'14:00', endTime:'15:30', location:'Film Room B',    objectives:'Tigers personnel + early offense.', createdBy:'Coach R. Patterson' },
    { id:'tr-4', title:'Shoot-Around',               date:'2026-05-20', startTime:'10:30', endTime:'11:30', location:'Main Arena',     objectives:'Spot shooting + free throws.', createdBy:'Coach R. Patterson' },
    { id:'tr-5', title:'Strength Block A',           date:'2026-05-21', startTime:'08:00', endTime:'09:30', location:'Weight Room',    objectives:'Lower body — squat / DL accessory.', createdBy:'Trainer S. Wells' },
  ]);

  // Trainer-owned data
  seedIfEmpty('attributes', ROSTER.map((p, i) => ({
    id:`at-${p.id}`, playerId:p.id, recordedAt: Date.now() - 86400000*(3+i), recordedBy:'Trainer S. Wells',
    heightCm: 178+i*2, weightKg: 78+i, bodyFatPct: 8+(i%5), wingspanCm: 185+i*2,
    verticalInches: 28+(i%7), fortyYdSec: Math.round((4.85-(i%4)*0.05)*100)/100,
    benchMax: 145+i*8, squatMax: 215+i*10,
    history: [
      { date:'2026-02-01', heightCm: 178+i*2, weightKg: 76+i, bodyFatPct: 9+(i%4), verticalInches: 27+(i%6), recordedBy:'Trainer S. Wells' },
      { date:'2026-04-01', heightCm: 178+i*2, weightKg: 77+i, bodyFatPct: 8+(i%5), verticalInches: 27+(i%7), recordedBy:'Trainer S. Wells' },
    ],
  })));

  seedIfEmpty('exercises', [
    { id:'ex-bs', name:'Back Squat', category:'Strength', muscleGroups:['Quads','Glutes'], equipment:'Barbell', difficulty:'Intermediate', desc:'Compound lower-body strength.' },
    { id:'ex-rdl',name:'Romanian Deadlift', category:'Strength', muscleGroups:['Hamstrings','Glutes'], equipment:'Barbell', difficulty:'Intermediate', desc:'Hip-hinge hamstring builder.' },
    { id:'ex-pp', name:'Push Press', category:'Strength', muscleGroups:['Shoulders','Triceps'], equipment:'Barbell', difficulty:'Intermediate', desc:'Explosive overhead press.' },
    { id:'ex-pu', name:'Pull-Up', category:'Strength', muscleGroups:['Lats','Biceps'], equipment:'Bar', difficulty:'Intermediate', desc:'Vertical pulling.' },
    { id:'ex-bj', name:'Box Jump', category:'Plyometric', muscleGroups:['Quads','Calves'], equipment:'Plyo Box', difficulty:'Beginner', desc:'Vertical jump development.' },
    { id:'ex-mb', name:'Med-Ball Slam', category:'Plyometric', muscleGroups:['Core','Lats'], equipment:'Medicine Ball', difficulty:'Beginner', desc:'Total-body power.' },
    { id:'ex-17', name:'17s — Sideline to Sideline', category:'Conditioning', muscleGroups:['Full body'], equipment:'None', difficulty:'Intermediate', desc:'Court sprint conditioning.' },
    { id:'ex-9090', name:'Hip 90/90', category:'Mobility', muscleGroups:['Hips'], equipment:'None', difficulty:'Beginner', desc:'Hip internal + external rotation.' },
    { id:'ex-fr', name:'Foam Roll — Lower Body', category:'Recovery', muscleGroups:['Full body'], equipment:'Foam Roller', difficulty:'Beginner', desc:'Soft tissue work.' },
    { id:'ex-mik',name:'Mikan Drill', category:'Skill', muscleGroups:['Coordination'], equipment:'Basketball', difficulty:'Beginner', desc:'Right/left finishes at the rim.' },
    { id:'ex-pln',name:'Plank (Front)', category:'Core', muscleGroups:['Core'], equipment:'None', difficulty:'Beginner', desc:'Isometric core hold.' },
  ]);

  seedIfEmpty('workouts', [
    { id:'wo-pl-1', playerId:'pl-1', title:'Guard Conditioning A', assignedBy:'Trainer S. Wells', assignedAt: Date.now()-86400000*3, focus:'Conditioning + ball-handling', status:'active',
      blocks:[
        { name:'Warm-up',  exercises:[{ exId:'ex-9090', sets:1, reps:'5 min' }] },
        { name:'Strength', exercises:[{ exId:'ex-bs', sets:4, reps:'6' }, { exId:'ex-rdl', sets:3, reps:'8' }, { exId:'ex-pu', sets:3, reps:'AMRAP' }] },
        { name:'Court',    exercises:[{ exId:'ex-mik', sets:6, reps:'30s' }, { exId:'ex-17', sets:3, reps:'<65s' }] },
      ],
    },
    { id:'wo-pl-2', playerId:'pl-2', title:'Wing Power + C&S', assignedBy:'Trainer S. Wells', assignedAt: Date.now()-86400000*4, focus:'Lower-body power + spot-up', status:'active',
      blocks:[
        { name:'Power', exercises:[{ exId:'ex-bj', sets:4, reps:'5' }, { exId:'ex-rdl', sets:4, reps:'5' }, { exId:'ex-mb', sets:3, reps:'8' }] },
      ],
    },
    { id:'wo-pl-5', playerId:'pl-5', title:'Big Block + Roll', assignedBy:'Trainer S. Wells', assignedAt: Date.now()-86400000*5, focus:'Roll-to-rim speed', status:'active',
      blocks:[
        { name:'Strength', exercises:[{ exId:'ex-bs', sets:4, reps:'6' }, { exId:'ex-pp', sets:4, reps:'5' }] },
      ],
    },
  ]);

  seedIfEmpty('dietPlans', [
    { id:'dt-pl-1', playerId:'pl-1', title:'Guard Fuel — In Season', assignedBy:'Trainer S. Wells', assignedAt: Date.now()-86400000*6, status:'active',
      kcal:3000, protein:180, carbs:380, fat:90, notes:'Carb-forward on practice days.',
      meals:[
        { time:'07:00', name:'Breakfast', items:'Oats + berries + 3 eggs + toast' },
        { time:'12:30', name:'Lunch',     items:'Chicken rice bowl + side salad' },
        { time:'15:30', name:'Pre-prac',  items:'Banana + PB toast' },
        { time:'19:00', name:'Dinner',    items:'Salmon + sweet potato + greens' },
        { time:'21:30', name:'Recovery',  items:'Cottage cheese + honey' },
      ],
    },
    { id:'dt-pl-5', playerId:'pl-5', title:'Big Man — Mass Maintain', assignedBy:'Trainer S. Wells', assignedAt: Date.now()-86400000*8, status:'active',
      kcal:3800, protein:220, carbs:430, fat:120, notes:'High-protein. Hydration 5L/day.',
      meals:[
        { time:'07:00', name:'Breakfast', items:'4 eggs + oats + protein shake' },
        { time:'12:30', name:'Lunch',     items:'Steak + rice + roasted veg' },
        { time:'19:30', name:'Dinner',    items:'Chicken + pasta + olive oil' },
      ],
    },
  ]);

  seedIfEmpty('injuries', [
    { id:'inj-1', playerId:'pl-3', title:'Left ankle sprain — Grade I', occurredAt:'2026-04-22', reportedBy:'Trainer S. Wells', reportedAt: Date.now()-86400000*16, severity:'Mild', mechanism:'Stepped on opponent foot, mid-game vs Knights.', bodyPart:'Left ankle', status:'recovered', treatment:'RICE 48h; band mobility days 3–7; return-to-play protocol days 7–10.', timeline:[
      { date:'2026-04-22', note:'Injury occurred. ER ruled out fracture.' },
      { date:'2026-04-30', note:'Cleared for non-contact court work.' },
      { date:'2026-05-03', note:'Cleared for full contact.' },
    ]},
    { id:'inj-2', playerId:'pl-9', title:'Right shoulder impingement', occurredAt:'2026-05-10', reportedBy:'Trainer S. Wells', reportedAt: Date.now()-86400000*7, severity:'Moderate', mechanism:'Overuse — high volume shooting reps.', bodyPart:'Right shoulder', status:'active', treatment:'PT 3x/week. No overhead pressing for 2 weeks.', timeline:[
      { date:'2026-05-10', note:'Pain reported after practice. Imaging clean.' },
      { date:'2026-05-12', note:'Started PT. Cuban presses + scap stability.' },
    ]},
    { id:'inj-3', playerId:'pl-7', title:'Left hamstring tightness', occurredAt:'2026-05-13', reportedBy:'Trainer S. Wells', reportedAt: Date.now()-86400000*4, severity:'Mild', mechanism:'Acceleration during conditioning.', bodyPart:'Left hamstring', status:'monitoring', treatment:'Daily soft tissue + eccentric hamstring work.', timeline:[
      { date:'2026-05-13', note:'Reported tightness. No tear on palpation.' },
    ]},
  ]);

  seedIfEmpty('rotations', [
    { id:'rt-gm-3', gameId:'gm-3', totalMinutes:48,
      starters:['pl-1','pl-2','pl-3','pl-4','pl-5'],
      players: ROSTER.map((p, i) => ({ playerId: p.id, mins: i < 5 ? 32-i : 14+(i%3), role: i < 5 ? 'Starter' : 'Bench', subFor: i < 5 ? null : ROSTER[i-5]?.id || null })),
      notes:'PG rotation: Marcus → Aiden at 6:00 of each quarter. Watch foul trouble on K. Brown.',
    },
  ]);

  seedIfEmpty('videos', [
    { id:'vd-1', title:'Princeton Chin — Game 4', description:'Full play execution from gm-4.', taggedPlayerIds:['pl-1','pl-3','pl-4','pl-5'], has2DMap:true, keyframeCount:3, playId:'play-princeton', uploadedAt: Date.now()-86400000*3, uploadedBy:'Coach R. Patterson', durationSec:18.6,
      keyframes:[
        { time:0,   players:{ o1:{x:250,y:380}, o2:{x:80,y:230}, o3:{x:420,y:230}, o4:{x:165,y:95}, o5:{x:335,y:95} } },
        { time:9.6, players:{ o1:{x:330,y:280}, o2:{x:80,y:230}, o3:{x:420,y:230}, o4:{x:200,y:180}, o5:{x:250,y:60} } },
        { time:13,  players:{ o1:{x:360,y:250}, o2:{x:80,y:230}, o3:{x:420,y:230}, o4:{x:200,y:180}, o5:{x:250,y:55} } },
      ],
    },
    { id:'vd-2', title:'Spain PnR — Knights, Q3', description:'Two reps in a row. 5 finishes the lob on the second.', taggedPlayerIds:['pl-1','pl-2','pl-4','pl-5'], has2DMap:true, keyframeCount:2, playId:'play-pnr-right', uploadedAt: Date.now()-86400000*5, uploadedBy:'Coach R. Patterson', durationSec:22.1,
      keyframes:[
        { time:0,  players:{ o1:{x:330,y:300}, o2:{x:80,y:230}, o3:{x:420,y:200}, o4:{x:165,y:95}, o5:{x:330,y:230} } },
        { time:18, players:{ o1:{x:380,y:220}, o2:{x:80,y:230}, o3:{x:420,y:200}, o4:{x:165,y:95}, o5:{x:250,y:90}  } },
      ],
    },
  ]);

  seedIfEmpty('messages', [
    { id:'msg-1', from:{ role:'coach', name:'Coach R. Patterson', userId:'coach-1' }, to:{ scope:'team', teamId:'team:default' }, kind:'announcement',
      subject:'Bus departs 7:30 Saturday', body:'Light dinner at the hotel after walk-through.', sentAt: Date.now()-86400000*1, readBy:{}, threadId:'th-1' },
    { id:'msg-2', from:{ role:'coach', name:'Coach R. Patterson', userId:'coach-1' }, to:{ scope:'player', playerId:'pl-1' }, kind:'direct',
      subject:'Princeton starts', body:'Marcus — you’re leading the chin entry on Saturday.', sentAt: Date.now()-86400000*2, readBy:{}, threadId:'th-2' },
    { id:'msg-3', from:{ role:'trainer', name:'Trainer S. Wells', userId:'trainer-1' }, to:{ scope:'player', playerId:'pl-1' }, kind:'direct',
      subject:'Recovery check-in', body:'How’s the ankle feeling? Strength block A is locked in.', sentAt: Date.now()-86400000*3, readBy:{}, threadId:'th-3' },
    { id:'msg-4', from:{ role:'coach', name:'Coach R. Patterson', userId:'coach-1' }, to:{ scope:'team', teamId:'team:default' }, kind:'announcement',
      subject:'Profile verification deadline', body:'Please complete your profile by Friday.', sentAt: Date.now()-86400000*7, readBy:{}, threadId:'th-4' },
  ]);
}

function run() {
  seedUsers();
  seedKv();
  console.log('seed complete.');
}

if (require.main === module) run();
module.exports = { run };
