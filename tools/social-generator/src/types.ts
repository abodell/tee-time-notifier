export interface GlobalState {
    courseName: string;
    holes: number;
    dateTime: string;
    price: string;
    backgroundImage: string;
    templateId: 'sneaker' | 'aspirational' | 'sniper' | 'nostalgia' | 'meme';
    customText1?: string;
    customText2?: string;
    customText3?: string;
    customText4?: string;
    customText5?: string;
}

export const defaultState: GlobalState = {
    courseName: 'Bethpage State Park (Black)',
    holes: 18,
    dateTime: 'Saturday, May 18 @ 8:10 AM',
    price: '$150.00',
    backgroundImage: '', // default bg will be handled in templates if empty
    templateId: 'sneaker',
};
