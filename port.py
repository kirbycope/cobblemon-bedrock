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
    print("Creating texts...")
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
    print("Create text complete.")

def download_spawn_egg_textures():
    print("Downloading spawn egg textures...")
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
    print("Download spawn egg textures complete.")

def create_animation_controllers():
    print("Creating animation controllers...")
    if not os.path.exists(animationControllers): os.makedirs(animationControllers)
    for pokemon in pokemons:
        pokemonName = pokemon[pokemon.index("_")+1:]
        fileName = f"{animationControllers}/{pokemon}.animation_controllers.json"
        entity = {
            "format_version": "1.10.0",
            "animation_controllers": {
                f"controller.animation.{pokemonName}.pose": {
                    "initial_state": "idle",
                    "states": {
                        "idle" : {
                            "animations" : [ "ground_idle" ],
                            "transitions": [ {"moving": "q.modified_move_speed > 0.1"} ],
                            "blend_transition": 0.2
                        },
                        "moving" : {
                            "animations" : [ "ground_idle", "ground_walk" ],
                            "transitions": [ {"idle": "q.modified_move_speed < 0.1"} ],
                            "blend_transition": 0.2
                        },
                        "sleeping": {
                            "animations": ["sleep"]
                        },
                        "fainting": {
                            "animations": ["faint"]
                        }
                    }
                }
            }
        }
        jsonData = json.dumps(entity, indent=4)
        with open(fileName, "w") as file:
            file.write(jsonData)
    print("Create animation controllers complete.")

def create_client_entities():
    print("Creating client entities...")
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
                        "default": f"geometry.{pokemonName}"
                    },
                    "scripts": {
                        "animate": ["pose"]
                    },
                    "animations": {
                        "faint": f"animation.{pokemonName}.faint",
                        "ground_idle": f"animation.{pokemonName}.ground_idle",
                        "ground_walk": f"animation.{pokemonName}.ground_walk",
                        "sleep": f"animation.{pokemonName}.sleep",
                        "pose": f"controller.animation.{pokemonName}.pose"
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
    print("Create client entities complete.")

#copy_animations()
#copy_models()
#copy_textures()
pokemons = next(os.walk(texturesEntityBedrock))[1]
create_texts()
#download_spawn_egg_textures()
create_animation_controllers()
create_client_entities() # ToDo: Dynamic animations definition
