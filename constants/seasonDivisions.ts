export type SeasonDivision = {
  name: string;
  rating: string;
  spots: number;
};

export const SEASON_DIVISIONS: SeasonDivision[] = [
  { name: "Beginner", rating: "2.0", spots: 5 },
  { name: "Intermediate Silver", rating: "2.5–3.0", spots: 3 },
  { name: "Intermediate Gold", rating: "3.5", spots: 0 },
  { name: "Advanced", rating: "4.0+", spots: 11 },
];
