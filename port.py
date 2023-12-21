# Run this to port from `cobblemon-main` to `cobblemon-bedrock`

import os
import json
import shutil
import urllib.request

pwd = os.getcwd()

# cobblemon-bedrock
animationsBedrock = f"{pwd}/development_resource_packs/cobblemon/animations"
animationControllers = f"{pwd}/development_resource_packs/cobblemon/animation_controllers"
entityBedrock = f"{pwd}/development_resource_packs/cobblemon/entity"
modelsBedrock = f"{pwd}/development_resource_packs/cobblemon/models"
textsBedrock = f"{pwd}/development_resource_packs/cobblemon/texts"
texturesEntityBedrock = f"{pwd}/development_resource_packs/cobblemon/textures/entity"
texturesItemsBedrock = f"{pwd}/development_resource_packs/cobblemon/textures/items"

# cobblemon-main
animationsMain = "C:/Users/kirby/Downloads/cobblemon-main/cobblemon-main/common/src/main/resources/assets/cobblemon/bedrock/pokemon/animations"
modelsMain = "C:/Users/kirby/Downloads/cobblemon-main/cobblemon-main/common/src/main/resources/assets/cobblemon/bedrock/pokemon/models"
texturesMain = "C:/Users/kirby/Downloads/cobblemon-main/cobblemon-main/common/src/main/resources/assets/cobblemon/textures/pokemon"

pokemons = None

def copy_animations():
    print("Copying animations...")
    if not os.path.exists(animationsBedrock): os.makedirs(animationsBedrock)
    shutil.copytree(src = animationsMain, dst = animationsBedrock, dirs_exist_ok=True)
    print("Copy animations complete.")

def copy_models():
    print("Copying models...")
    if not os.path.exists(modelsBedrock): os.makedirs(modelsBedrock)
    shutil.copytree(src = modelsMain, dst = modelsBedrock, dirs_exist_ok=True)
    print("Copy models complete.")

def copy_textures():
    print("Copying textures...")
    if not os.path.exists(texturesEntityBedrock): os.makedirs(texturesEntityBedrock)
    shutil.copytree(src = texturesMain, dst = texturesEntityBedrock, dirs_exist_ok=True)
    print("Copy textures complete.")

def create_texts():
    print("Adding texts...")
    if not os.path.exists(textsBedrock): os.makedirs(textsBedrock)
    fileName = f"{textsBedrock}/en_US.lang"
    if os.path.exists(f"{textsBedrock}/en_US.lang"): os.remove(fileName)
    with open(fileName, "w") as file:
        for pokemon in pokemons:
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

def download_spawn_egg_textures():
    print("Downloading sprites...")
    if not os.path.exists(texturesItemsBedrock): os.makedirs(texturesItemsBedrock)
    for pokemon in pokemons:
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

def create_client_entities():
    print("Generating Client Entity files...")
    if not os.path.exists(entityBedrock): os.makedirs(entityBedrock)
    for pokemon in pokemons:
        pokemonName = pokemon[pokemon.index("_")+1:]
        fileName = f"{entityBedrock}/{pokemon}.entity.json"
        if os.path.exists(f"{textsBedrock}/en_US.lang"): os.remove(fileName)
        entity = {
            "format_version": "1.10.0",
            "minecraft:client_entity": {
                "description": {
                    "identifier": f"cobblemon:{pokemon}",
                    "materials": {
                        "default": "entity_alphatest"
                    },
                    "textures": {
                        "default": f"textures/entity/{pokemon}/{pokemonName}"
                    },
                    "geometry": {
                        "default": f"geometry.{pokemon}"
                    },
                    "scripts": {
                        "animate": ["pose"]
                    },
                    "animations": {
                        "blink": "animation.name.blink",
                        "cry": "animation.name.cry",
                        "faint": "animation.name.faint",
                        "ground_idle": "animation.name.ground_idle",
                        "ground_walk": "animation.name.ground_walk",
                        "sleep": "animation.name.sleep",
                        "pose": "controller.animation.name.pose"
                    },
                    "render_controllers": ["controller.render.agent"],
                    "spawn_egg": {
                        "texture": f"{pokemon}_spawn_egg"
                    }
                }
            }
        }
        jsonData = json.dumps(entity, indent=4)
        with open(fileName, "w") as file:
            file.write(jsonData)
    print("Generate Client Entity files complete...")

#copy_animations()
#copy_models()
#copy_textures()
# Get a list of Pokemon
pokemons = next(os.walk(texturesEntityBedrock))[1]
#create_texts()
#download_spawn_egg_textures()
create_client_entities()
