/* the original's resource equipmentmods_defaults (effect groups, names, 'negative' = lower is better, 'absolute' = a count) */
'use strict';
const MODS_DEFAULTS = [
 {
  "id": "ship",
  "source": "ship",
  "name": "{1001,8038}",
  "index": "1",
  "effects": [
   {
    "id": "mass",
    "name": "{20110,12001}",
    "description": "{20110,12002}",
    "basename": "{20110,102001}",
    "index": "1",
    "negative": "True"
   },
   {
    "id": "drag",
    "name": "{20110,12011}",
    "description": "{20110,12012}",
    "basename": "{20110,102011}",
    "index": "2",
    "negative": "True"
   },
   {
    "id": "maxhull",
    "name": "{20110,12021}",
    "description": "{20110,12022}",
    "basename": "{20110,102021}",
    "index": "3"
   },
   {
    "id": "unitcapacity",
    "name": "{20110,12031}",
    "description": "{20110,12032}",
    "basename": "{20110,102031}",
    "index": "4",
    "absolute": "True"
   },
   {
    "id": "missilecapacity",
    "name": "{20110,12041}",
    "description": "{20110,12042}",
    "basename": "{20110,102041}",
    "index": "5",
    "absolute": "True"
   },
   {
    "id": "bombcapacity",
    "name": "{20110,12051}",
    "description": "{20110,12052}",
    "basename": "{20110,102051}",
    "index": "6",
    "absolute": "True"
   },
   {
    "id": "countermeasurecapacity",
    "name": "{20110,12061}",
    "description": "{20110,12062}",
    "basename": "{20110,102061}",
    "index": "7",
    "absolute": "True"
   },
   {
    "id": "deployablecapacity",
    "name": "{20110,12071}",
    "description": "{20110,12072}",
    "basename": "{20110,102071}",
    "index": "8",
    "absolute": "True"
   },
   {
    "id": "radarrange",
    "name": "{20110,12101}",
    "description": "{20110,12102}",
    "basename": "{20110,102091}",
    "index": "9"
   },
   {
    "id": "regiondamage",
    "name": "{20110,13041}",
    "description": "{20110,13042}",
    "basename": "{20110,102111}",
    "index": "a",
    "noncalc": "True"
   },
   {
    "id": "radarcloak",
    "name": "{20110,13031}",
    "description": "{20110,13032}",
    "basename": "{20110,102101}",
    "index": "b",
    "noncalc": "True"
   },
   {
    "id": "hidecargochance",
    "name": "{20110,13051}",
    "description": "{20110,13052}",
    "basename": "{20110,102121}",
    "index": "c",
    "noncalc": "True"
   }
  ]
 },
 {
  "id": "engine",
  "source": "engine",
  "name": "{1001,8028}",
  "index": "2",
  "effects": [
   {
    "id": "forwardthrust",
    "name": "{20110,11001}",
    "description": "{20110,11002}",
    "basename": "{20110,101001}",
    "index": "1"
   },
   {
    "id": "rotationthrust",
    "name": "{20110,11011}",
    "description": "{20110,11012}",
    "basename": "{20110,101011}",
    "index": "2"
   },
   {
    "id": "strafethrust",
    "name": "{20110,11021}",
    "description": "{20110,11022}",
    "basename": "{20110,101021}",
    "index": "3"
   },
   {
    "id": "boostthrust",
    "name": "{20110,11031}",
    "description": "{20110,11032}",
    "basename": "{20110,101031}",
    "index": "4"
   },
   {
    "id": "boostduration",
    "name": "{20110,11041}",
    "description": "{20110,11042}",
    "basename": "{20110,101041}",
    "index": "5"
   },
   {
    "id": "boostattacktime",
    "name": "{20110,11051}",
    "description": "{20110,11052}",
    "basename": "{20110,101051}",
    "index": "6",
    "negative": "True"
   },
   {
    "id": "boostreleasetime",
    "name": "{20110,11061}",
    "description": "{20110,11062}",
    "basename": "{20110,101061}",
    "index": "7",
    "negative": "True"
   },
   {
    "id": "boostchargetime",
    "name": "{20110,11071}",
    "description": "{20110,11072}",
    "basename": "{20110,1010071}",
    "index": "8",
    "negative": "True"
   },
   {
    "id": "boostrechargetime",
    "name": "{20110,11081}",
    "description": "{20110,11082}",
    "basename": "{20110,101081}",
    "index": "9",
    "negative": "True"
   },
   {
    "id": "boostshielddrain",
    "name": "{20110,11091}",
    "description": "{20110,11092}",
    "basename": "{20110,101091}",
    "index": "a"
   },
   {
    "id": "travelthrust",
    "name": "{20110,11101}",
    "description": "{20110,11102}",
    "basename": "{20110,101101}",
    "index": "b"
   },
   {
    "id": "travelstartthrust",
    "name": "{20110,11111}",
    "description": "{20110,11112}",
    "basename": "{20110,101111}",
    "index": "c"
   },
   {
    "id": "travelattacktime",
    "name": "{20110,11121}",
    "description": "{20110,11122}",
    "basename": "{20110,101121}",
    "index": "d",
    "negative": "True"
   },
   {
    "id": "travelreleasetime",
    "name": "{20110,11131}",
    "description": "{20110,11132}",
    "basename": "{20110,101131}",
    "index": "e",
    "negative": "True"
   },
   {
    "id": "travelchargetime",
    "name": "{20110,11141}",
    "description": "{20110,11142}",
    "basename": "{20110,101141}",
    "index": "f",
    "negative": "True"
   },
   {
    "id": "strafeacc",
    "name": "{20110,111310011}",
    "description": "{20110,101132}",
    "basename": "{20110,111310012}",
    "index": "4"
   },
   {
    "id": "boostacc",
    "name": "{20110,111110011}",
    "description": "{20110,101112}",
    "basename": "{20110,111110012}",
    "index": "6"
   }
  ]
 },
 {
  "id": "shield",
  "source": "shield",
  "name": "{1001,8515}",
  "index": "3",
  "effects": [
   {
    "id": "capacity",
    "name": "{20110,13001}",
    "description": "{20110,13002}",
    "basename": "{20110,103001}",
    "index": "1"
   },
   {
    "id": "rechargedelay",
    "name": "{20110,13011}",
    "description": "{20110,13012}",
    "basename": "{20110,103011}",
    "index": "2",
    "negative": "True"
   },
   {
    "id": "rechargerate",
    "name": "{20110,13021}",
    "description": "{20110,13022}",
    "basename": "{20110,103021}",
    "index": "3"
   }
  ]
 },
 {
  "id": "weapon",
  "source": "weapon",
  "name": "{1001,6600}",
  "index": "4",
  "effects": [
   {
    "id": "damage",
    "name": "{20110,10001}",
    "description": "{20110,10002}",
    "basename": "{20110,100001}",
    "index": "1"
   },
   {
    "id": "cooling",
    "name": "{20110,10011}",
    "description": "{20110,10012}",
    "basename": "{20110,100011}",
    "index": "2"
   },
   {
    "id": "reload",
    "name": "{20110,10021}",
    "description": "{20110,10022}",
    "basename": "{20110,100021}",
    "index": "3"
   },
   {
    "id": "speed",
    "name": "{20110,10031}",
    "description": "{20110,10032}",
    "basename": "{20110,100031}",
    "index": "4"
   },
   {
    "id": "lifetime",
    "name": "{20110,10041}",
    "description": "{20110,10042}",
    "basename": "{20110,100041}",
    "index": "5"
   },
   {
    "id": "mining",
    "name": "{20110,10051}",
    "description": "{20110,10052}",
    "basename": "{20110,100051}",
    "index": "6"
   },
   {
    "id": "sticktime",
    "name": "{20110,10061}",
    "description": "{20110,10062}",
    "basename": "{20110,100061}",
    "index": "7"
   },
   {
    "id": "chargetime",
    "name": "{20110,10071}",
    "description": "{20110,10072}",
    "basename": "{20110,100071}",
    "index": "8",
    "negative": "True"
   },
   {
    "id": "beamlength",
    "name": "{20110,10081}",
    "description": "{20110,10082}",
    "basename": "{20110,100081}",
    "index": "9"
   },
   {
    "id": "amount",
    "name": "{20110,10091}",
    "description": "{20110,10092}",
    "basename": "{20110,100091}",
    "index": "a",
    "absolute": "True"
   },
   {
    "id": "rotationspeed",
    "name": "{20110,10101}",
    "description": "{20110,10102}",
    "basename": "{20110,100101}",
    "index": "b"
   },
   {
    "id": "surfaceelement",
    "name": "{20110,10111}",
    "description": "{20110,10112}",
    "basename": "{20110,100111}",
    "index": "c"
   }
  ]
 }
];
