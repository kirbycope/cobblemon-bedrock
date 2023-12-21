# Run this to port from `cobblemon-main` to `cobblemon-bedrock`

import os
import urllib.request
import shutil

pwd = os.getcwd()

# cobblemon-bedrock
animationsBedrock = f"{pwd}/development_resource_packs/cobblemon/animations"
animationControllers = f"{pwd}/development_resource_packs/cobblemon/animation_controllers"
modelsBedrock = f"{pwd}/development_resource_packs/cobblemon/models"
textsBedrock = f"{pwd}/development_resource_packs/cobblemon/texts"
texturesEntityBedrock = f"{pwd}/development_resource_packs/cobblemon/textures/entity"
texturesItemsBedrock = f"{pwd}/development_resource_packs/cobblemon/textures/items"

# cobblemon-main
animationsMain = "C:/Users/kirby/Downloads/cobblemon-main/cobblemon-main/common/src/main/resources/assets/cobblemon/bedrock/pokemon/animations"
modelsMain = "C:/Users/kirby/Downloads/cobblemon-main/cobblemon-main/common/src/main/resources/assets/cobblemon/bedrock/pokemon/models"
texturesMain = "C:/Users/kirby/Downloads/cobblemon-main/cobblemon-main/common/src/main/resources/assets/cobblemon/textures/pokemon"

# Animations (direct copy from Cobblestone)
print("Copying animations...")
if not os.path.exists(animationsBedrock): os.makedirs(animationsBedrock)
shutil.copytree(src = animationsMain, dst = animationsBedrock, dirs_exist_ok=True)
print("Copy animations complete.")

# Models (direct copy from Cobblestone)
print("Copying models...")
if not os.path.exists(modelsBedrock): os.makedirs(modelsBedrock)
shutil.copytree(src = modelsMain, dst = modelsBedrock, dirs_exist_ok=True)
print("Copy models complete.")

# Textures (direct copy from Cobblestone)
print("Copying textures...")
if not os.path.exists(texturesEntityBedrock): os.makedirs(texturesEntityBedrock)
shutil.copytree(src = texturesMain, dst = texturesEntityBedrock, dirs_exist_ok=True)
print("Copy textures complete.")

# For later... (texts and spawn eggs)
pokemons = next(os.walk(texturesEntityBedrock))[1]

# Texts
print("Adding texts...")
if not os.path.exists(textsBedrock): os.makedirs(textsBedrock)
fileName = f"{textsBedrock}/en_US.lang"
if os.path.exists(f"{textsBedrock}/en_US.lang"): os.remove(fileName)
with open(fileName, "w") as file:
    for pokemon in pokemons:
        if "_" in pokemon:
            pokemonName = pokemon[pokemon.index("_")+1:].capitalize()
            # Name "fixes" for Display Name
            pokemonName = pokemonName.replace("Nidoranf","Nidoran F")
            pokemonName = pokemonName.replace("Nidoranm","Nidoran M")
            pokemonName = pokemonName.replace("Mrmime","Mr Mime")
            pokemonName = pokemonName.replace("Mimejr","Mime Jr")
            pokemonName = pokemonName.replace("Porygonz","Porygon Z")
            pokemonName = pokemonName.replace("Walkingwake","Walking Wake")
            pokemonName = pokemonName.replace("Ironleaves","Iron Leaves")
            file.write(f"entity.cobblemon:{pokemon}.name={pokemonName}\n")
            file.write(f"item.spawn_egg.entity.cobblemon:{pokemon}.name=Spawn {pokemonName}\n")
print("Add text complete.")

# Spawn Eggs
print("Downloading sprites...")
for pokemon in pokemons:
    if "_" in pokemon:
        spriteBaseUri1 = "https://img.pokemondb.net/sprites/sword-shield/icon"
        spriteBaseUri2 = "https://img.pokemondb.net/sprites/scarlet-violet/icon"
        opener = urllib.request.URLopener()
        opener.addheader('User-Agent', 'Mozilla/5.0 (Linux; Android 13; SM-S901B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36')
        fileName = f"{texturesItemsBedrock}/{pokemon}_spawn_egg.png"
        pokemonName = pokemon[pokemon.index("_")+1:]
        # Name "fixes" for URL
        pokemonName = pokemonName.replace("nidoranf","nidoran-f")
        pokemonName = pokemonName.replace("nidoranm","nidoran-m")
        pokemonName = pokemonName.replace("mrmime","mr-mime")
        pokemonName = pokemonName.replace("mimejr","mime-jr")
        pokemonName = pokemonName.replace("porygonz","porygon-z")
        pokemonName = pokemonName.replace("walkingwake","walking-wake")
        pokemonName = pokemonName.replace("ironleaves","iron-leaves")
        try:
            spriteUrl = f"{spriteBaseUri1}/{pokemonName}.png"
            opener.retrieve(spriteUrl, fileName)
        except:
            try:
                spriteUrl = f"{spriteBaseUri2}/{pokemonName}.png"
                opener.retrieve(spriteUrl, fileName)
            except Exception as e: print(f"Failed to download: {pokemon}")
print("Download sprites complete.")
