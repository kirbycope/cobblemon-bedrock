// PlatformType.getPlatformTypeForPokemon: the raft's size by the Pokemon's width (hitbox width times base scale)
import { M, D, check } from "../harness.mjs";

check("to 0.511 an XS raft", M.raftSize(0.5) === 0 && M.raftSize(0.511) === 0);
check("under 1.01 an S", M.raftSize(0.6) === 1 && M.raftSize(1.0) === 1);
check("under 1.8 an M", M.raftSize(1.01) === 2 && M.raftSize(1.79) === 2);
check("under 2.875 an L", M.raftSize(1.8) === 3 && M.raftSize(2.8) === 3);
check("past it an XL", M.raftSize(2.875) === 4 && M.raftSize(5) === 4);
check("a swimmer never takes one, a walker does", D.POKEMON["cobblemon:p0129_magikarp"]?.noRaft === true && !D.POKEMON["cobblemon:p0003_venusaur"]?.noRaft);
