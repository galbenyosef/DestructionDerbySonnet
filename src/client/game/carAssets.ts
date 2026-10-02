import type { CarId } from '../../shared/cars';
import coupePicture from '../assets/car_coupe.png?url';
import coupeModel from '../assets/car_coupe.glb?url';
import pickupPicture from '../assets/car_pickup.png?url';
import pickupModel from '../assets/car_pickup.glb?url';
import sedanPicture from '../assets/car_sedan.png?url';
import sedanModel from '../assets/car_sedan.glb?url';
import wagonPicture from '../assets/car_wagon.png?url';
import wagonModel from '../assets/car_wagon.glb?url';

/**
 * Where the Blender model of each car is served from (`art/cars/densify_cars.py` writes the files), and the picture of it the menu
 * shows. A car whose model fails to load is drawn as the boxes `CarView` builds itself.
 */
export const CAR_MODEL_URLS: Readonly<Record<CarId, string>> = { sedan: sedanModel, coupe: coupeModel, wagon: wagonModel, pickup: pickupModel };
export const CAR_PICTURE_URLS: Readonly<Record<CarId, string>> = { sedan: sedanPicture, coupe: coupePicture, wagon: wagonPicture, pickup: pickupPicture };
