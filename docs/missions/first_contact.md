# First contact (story, Act I mission 3): the first fight's mission, script v1 (9 Nov 2026)

Low orbit, 400 km over the Nile. The Argo hides beyond the Moon; Dev Arora (the player) leads the wing on a gunnery
run with Noor Haddad, Kai Mendes and Amara Okafor flying beside him (docs/design/GAME_DESIGN.md, "The people"). A
radio call from the Holdouts at the Seed Vault on Svalbard (78 deg N) gives them away: the Harrow come in three
waves, each bigger than the last. It sets up the next missions (Farside, The Vault).

Voices: the owner's cast (art/audio/README.md): ARGO "Vesper" (dry, she is the ship), Dev "Xavier", Amara "Naomi",
Kai "Caspian", Noor "Nora" (all over the fighters' radio), and a Holdout at Svalbard, "Petra", through heavy static.
Each line's sound is /Game/Audio/Radio/FC_<id>; RewildRadio shows the subtitle whether or not the sound exists.

## Beats

| Beat | Starts when | Objective shown |
|---|---|---|
| Intro | the mission starts | none |
| Practice | after the intro | Destroy three practice drones |
| Signal | three drones down, or 80 s | none |
| Wave 1 | after the signal: four Reapers 3.5 km ahead | Destroy the Harrow fighters |
| Wave 2 | wave 1 down, 6 s later: five Reapers | Destroy the Harrow fighters |
| Wave 3 | wave 2 down, 6 s later: six Reapers, splitting to both sides | Destroy the Harrow fighters |
| Won | wave 3 down | Mission complete |
| Lost | Dev shot down | Shot down: try again from the start of the wave, or the main menu |

Checkpoints (saved, for Continue): the start, and the start of each wave.

## Lines

| Id | Who | Line | When |
|---|---|---|---|
| i01 | ARGO | Four hundred kilometres up. That's the Nile under you, Dev. | intro |
| i02 | Dev | So that's Earth. | intro |
| i03 | Noor | It's all desert. Where did all the green go? | intro |
| i04 | Kai | Three hundred years with nobody to look after it. Give it time. | intro |
| i05 | Dev | All right, range is hot. Drones ahead. Let's see if we can still shoot straight. | intro, then practice |
| d01 | Kai | One down. Show-off. | first drone |
| d02 | Amara | That's two. | second drone |
| s01 | ARGO | Dev, I'm picking up a voice. Ground source, seventy-eight north. | signal |
| s02 | Holdout | Anyone up there... this is Svalbard... we can see your engines... please... they're in the vault... | signal |
| s03 | Amara | Svalbard. The Seed Vault. There are still people down there. | signal |
| s04 | Noor | Then we answer them. | signal |
| s05 | ARGO | Contact. Four Harrow fighters, over the horizon. They heard it too. | wave 1 |
| s06 | Dev | Reapers. Weapons free. Everyone stay on me. | wave 1 |
| w2a | ARGO | Five more, high on your left. | wave 2 |
| w2b | Kai | They're testing us. | wave 2 |
| w3a | ARGO | Six. They're splitting up to come at you from both sides. | wave 3 |
| w3b | Dev | Then so do we. Noor, Kai, take the left. Amara, you're with me. | wave 3 |
| e01 | ARGO | That's the last of them. Their carrier will know by now. | won |
| e02 | Dev | Svalbard, this is the Argo. We hear you. Hold on. We're coming. | won |
| e03 | Holdout | We hear you... we'll hold... | won |
| f01 | ARGO | Dev? Dev, answer me. | lost |

Chatter, when it happens (one at a time, at most one every 6 s; story beats come first):

| Id | Who | Line | When |
|---|---|---|---|
| k1 | Kai | Got one! | a wingman's kill |
| k2 | Noor | He's down. | a wingman's kill |
| k3 | Amara | Scratch one Reaper. | a wingman's kill |
| p1 | Kai | Nice shot, Dev! | Dev's kill |
| p2 | Amara | Good kill. | Dev's kill |
| p3 | Noor | That's one less. | Dev's kill |
| t1 | Kai | Dev, one on your tail! | a Reaper close behind Dev |
| t2 | Amara | Break, Dev, you've got one behind you! | a Reaper close behind Dev |
| t3 | Noor | Dev, behind you! | a Reaper close behind Dev |
| a1 | ARGO | Missile lock. | a Reaper locking on to Dev |
| a2 | ARGO | Missile launched. Break and flare. | a Harrow missile on its way to Dev |
| a3 | ARGO | Shields down. | Dev's shield gone |
| a4 | ARGO | Hull breach. You can't take much more, Dev. | Dev's hull under a third |
| h1 | Kai | I'm hit, I'm hit! | a wingman hit hard |
| h2 | Noor | They got my shields! | a wingman hit hard |
| h3 | Amara | Taking fire! | a wingman hit hard |
| x1 | Kai | I'm out! Ejecting! | Kai shot down |
| x2 | Noor | I'm going down... punching out! | Noor shot down |
| x3 | Amara | Lost my engines. Ejecting! | Amara shot down |
| x4 | ARGO | I have their beacon. I'll pick them up. | after a wingman ejects |
| oa1 | Kai | On your target. | order: attack my target |
| oa2 | Noor | Copy, going after it. | order: attack my target |
| oa3 | Amara | Engaging your target. | order: attack my target |
| oc1 | Kai | Coming to you, Dev. | order: cover me |
| oc2 | Noor | I've got your back. | order: cover me |
| oc3 | Amara | Covering you. | order: cover me |
| of1 | Kai | Forming up. | order: form up |
| of2 | Noor | On your wing. | order: form up |
| of3 | Amara | Rejoining. | order: form up |
| oe1 | Kai | Weapons free! | order: weapons free |
| oe2 | Amara | Picking my own. | order: weapons free |
| oe3 | Noor | Going hunting. | order: weapons free |

Orders (keyboard 1-4, gamepad d-pad): 1 attack my target, 2 cover me, 3 form up, 4 weapons free.
