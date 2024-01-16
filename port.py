import os
import json
import requests
import shutil
import urllib.request
from zipfile import ZipFile

pokemons = None
pwd = os.getcwd()

# cobblemon-bedrock
animationsBedrock = f"{pwd}/development_resource_packs/cobblemon/animations"
animationControllersBedrock = f"{pwd}/development_resource_packs/cobblemon/animation_controllers"
entityBedrock = f"{pwd}/development_resource_packs/cobblemon/entity"
entitiesBedrock = f"{pwd}/development_behavior_packs/cobblemon/entities"
modelsBedrock = f"{pwd}/development_resource_packs/cobblemon/models/entity"
textsBedrock = f"{pwd}/development_resource_packs/cobblemon/texts"
texturesEntityBedrock = f"{pwd}/development_resource_packs/cobblemon/textures/entity"
texturesItemsBedrock = f"{pwd}/development_resource_packs/cobblemon/textures/items"

# cobblemon-main
cobblemon = f"{pwd}/cobblemon-main/common/src/main/resources/assets/cobblemon"
animationsMain = f"{cobblemon}/bedrock/pokemon/animations"
modelsMain = f"{cobblemon}/bedrock/pokemon/models"
texturesMain = f"{cobblemon}/textures/pokemon"


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
        # Update item_texture.json
        with open(f"{pwd}//development_resource_packs/cobblemon/textures/item_texture.json", "r") as itemTexureFile:
            itemTextureData = json.load(itemTexureFile)
        itemTextureData["texture_data"][f"{pokemon}_spawn_egg"] = {}
        itemTextureData["texture_data"][f"{pokemon}_spawn_egg"]["textures"] = [f"textures/items/{pokemon}_spawn_egg"]
        itemTextureData = json.dumps(itemTextureData, indent=4)
        with open(f"{pwd}//development_resource_packs/cobblemon/textures/item_texture.json", "w") as itemTexureFile:
            itemTexureFile.write(itemTextureData)
    print("Download spawn egg textures complete.")


def create_animation_controllers():
    print("Creating animation controllers...")
    if not os.path.exists(animationControllersBedrock): os.makedirs(animationControllersBedrock)
    for pokemon in pokemons:
        pokemonName = pokemon[pokemon.index("_")+1:]
        fileName = f"{animationControllersBedrock}/{pokemon}.animation_controllers.json"
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
        try:
            pokemonName = pokemon[pokemon.index("_")+1:]
            fileName = f"{entityBedrock}/{pokemon}.entity.json"
            if os.path.exists(fileName): os.remove(fileName)
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
                            "pose": f"controller.animation.{pokemonName}.pose"
                        },
                        "render_controllers": ["controller.render.agent"],
                        "spawn_egg": {
                            "texture": f"{pokemon}_spawn_egg"
                        }
                    }
                }
            }
            animationFile = open(f"{animationsBedrock}/{pokemon}/{pokemonName}.animation.json")
            animationData = json.load(animationFile)
            animationFile.close()
            for animation in animationData["animations"]:
                shortName = animation[animation.rindex(".")+1:]
                currentAnimations = entity["minecraft:client_entity"]["description"]["animations"]
                entity["minecraft:client_entity"]["description"]["animations"] = currentAnimations | {shortName:animation}
            jsonData = json.dumps(entity, indent=4)
            with open(fileName, "w") as file:
                file.write(jsonData)
        except Exception as e: print(e)
    print("Create client entities complete.")


def create_behavior_entities():
    print("Creating behavior entities...")
    if not os.path.exists(entitiesBedrock): os.makedirs(entitiesBedrock)
    for pokemon in pokemons:
        try:
            fileName = f"{entitiesBedrock}/{pokemon}.behavior.json"
            if os.path.exists(fileName): os.remove(fileName)
            pokemonName = pokemon[pokemon.index("_")+1:]
            evolution = get_evolution(pokemonName)
            if evolution != None:
                # Set entity as an ageable baby
                jsonTemplateFile = open("development_behavior_packs/cobblemon/entities/0000_template.behavior.json")
                jsonTemplateData = json.load(jsonTemplateFile)
                jsonTemplateData["minecraft:entity"]["description"]["identifier"] = f"cobblemon:{pokemon}"
                jsonTemplateData["minecraft:entity"]["component_groups"]["grow_up"]["minecraft:transformation"]["into"] = f"cobblemon:{evolution}"
            else:
                # Set entity as an adult
                jsonTemplateFile = open("development_behavior_packs/cobblemon/entities/0001_template.behavior.json")
                jsonTemplateData = json.load(jsonTemplateFile)
                jsonTemplateData["minecraft:entity"]["description"]["identifier"] = f"cobblemon:{pokemon}"
            jsonTemplateFile.close()
            jsonData = json.dumps(jsonTemplateData, indent=4)
            with open(fileName, "w") as file:
                file.write(jsonData)
        except Exception as e: print(e)
    print("Create behavior entities complete.")


def get_cobblemon():
    url = "https://gitlab.com/cable-mc/cobblemon/-/archive/main/cobblemon-main.zip"
    os.system(f"curl {url} -O -L")
    with ZipFile("cobblemon-main.zip", 'r') as zip:
        zip.extractall(f"{pwd}")


def get_evolution(pokemonName):
    url = "https://pogoapi.net/api/v1/pokemon_evolutions.json"
    response = requests.get(url)
    jsonData = response.json()
    for item in jsonData:
        pokemon_name = str(item["pokemon_name"]).lower()
        evolution = None
        if  pokemon_name == pokemonName:
            evolution_id = item["evolutions"][0]["pokemon_id"]
            evolution_id = f"{evolution_id}".zfill(4)
            evolution_name = str(item["evolutions"][0]["pokemon_name"]).lower()
            evolution = f"{evolution_id}_{evolution_name}"
            break
    return evolution


get_cobblemon()
copy_animations()
copy_models()
copy_textures()
pokemons = next(os.walk(texturesEntityBedrock))[1]
create_texts()
download_spawn_egg_textures()
create_animation_controllers()
create_client_entities()
create_behavior_entities()
