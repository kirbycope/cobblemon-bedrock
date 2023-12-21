# Run this to port from `cobblemon-main` to `cobblemon-bedrock`
import os; pwd = os.getcwd()
import shutil, errno

#cobblemon-bedrock
animationsBedrock = f"{pwd}/development_resource_packs/cobblemon/animations"
animationControllers = f"{pwd}/development_resource_packs/cobblemon/animation_controllers"

# cobblemon-main
animationsMain = "C:/Users/kirby/Downloads/cobblemon-main/cobblemon-main/common/src/main/resources/assets/cobblemon/bedrock/pokemon/animations/"

shutil.copytree(animationsMain, animationsBedrock)
